#!/usr/bin/env node
// PreToolUse guard for Bash commands in this repo.
// Reads the hook payload on stdin and answers with a permission decision:
//   deny -> the command is blocked and the reason is shown to the agent
//   ask  -> the user is prompted, even if an allow rule would have matched
// Anything else passes through to the normal permission flow.
//
// This is a seatbelt against mistakes, not a security boundary: a shell
// command can always be rewritten to slip past a regex.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PAID_SERVICES =
  /\b(supabase\/(pro|team)|firecrawl\/(hobby|standard|growth)|vercel\/pro|openrouter\/pay_as_you_go)\b/;

const SECRET_FILE = /(^|[\s"'=/])\.env(?!\.example)(\.[\w.-]+)?(?=$|[\s"';|&)])|\.projects\/vault/;

// Tools that dump file contents to the terminal (and so into the transcript).
const DUMP_TOOLS = /(^|[\s;|&(])(cat|bat|less|more|head|tail|nl|strings|xxd|hexdump|base64|pbcopy|open)\s/;

const SECRET_PATTERNS = [
  ["Stripe secret key", /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}/],
  ["OpenRouter key", /\bsk-or-v1-[a-f0-9]{32,}/],
  ["Firecrawl key", /\bfc-[a-f0-9]{24,}/],
  ["ElevenLabs key", /\bsk_[a-f0-9]{40,}/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{16,}/],
  ["Vercel token", /\bvc[a-z]_[A-Za-z0-9]{20,}/],
  ["JWT (e.g. Supabase service_role key)", /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}/],
  ["Postgres URL with password", /postgres(ql)?:\/\/[^:\s/]+:[^@\s]{6,}@/],
];

function decide(permissionDecision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason: `[podify guard] ${reason}`,
      },
    }),
  );
  process.exit(0);
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function findSecret(text) {
  for (const [label, re] of SECRET_PATTERNS) if (re.test(text)) return label;
  return null;
}

function scanCommit(cmd) {
  const sweepsWorktree = /\bgit\s+add\b/.test(cmd) || /\bgit\s+commit\b[^;|&]*\s-[a-zA-Z]*a/.test(cmd);

  const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  const bad = staged.find((f) => SECRET_FILE.test(` ${f}`));
  if (bad) return `"${bad}" is staged. Secret files must never be committed; run \`git rm --cached ${bad}\`.`;

  const added = (diff) =>
    diff
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .join("\n");

  let text = added(git(["diff", "--cached", "-U0"]));
  if (sweepsWorktree) {
    text += "\n" + added(git(["diff", "-U0"]));
    for (const f of git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)) {
      try {
        if (statSync(f).size < 512 * 1024) text += "\n" + readFileSync(f, "utf8");
      } catch {
        /* unreadable or binary: skip */
      }
    }
  }
  const hit = findSecret(text);
  return hit ? `The changes being committed contain what looks like a ${hit}. Remove it and load it from the environment instead.` : null;
}

let cmd = "";
try {
  cmd = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.command ?? "";
} catch {
  process.exit(0);
}
if (!cmd) process.exit(0);

// --- Money: this project is free tier only -------------------------------
if (/--confirm-paid-service\b/.test(cmd))
  decide("deny", "--confirm-paid-service is not allowed. This project is free tier only; the user must run paid provisioning themselves.");
if (/\bstripe\s+projects\s+(add|update|upgrade)\b/.test(cmd) && PAID_SERVICES.test(cmd))
  decide("deny", "That is a paid plan. This project is free tier only; the user must run paid provisioning themselves.");
if (/\bstripe\s+projects\s+(upgrade|billing\s+add)\b/.test(cmd))
  decide("deny", "Upgrades and billing changes must be run by the user, not the agent.");

// --- Destructive or hard to undo -----------------------------------------
if (/\bstripe\s+projects\s+(remove|rotate|unlink|downgrade|env\s+delete)\b/.test(cmd))
  decide("ask", "This removes a resource, rotates credentials or unlinks a provider. Confirm with the user.");
if (/\bgit\s+push\b[^;|&]*(--force\b|--force-with-lease\b|\s-f\b)/.test(cmd))
  decide("ask", "Force push rewrites remote history. Confirm with the user.");
if (/\b(vercel|npx\s+(--yes\s+)?vercel)\s+(rm|remove|project\s+rm|env\s+rm)\b/.test(cmd))
  decide("ask", "This deletes a Vercel project, deployment or env var. Confirm with the user.");

// --- Secrets --------------------------------------------------------------
if (DUMP_TOOLS.test(cmd) && SECRET_FILE.test(cmd))
  decide("deny", "Do not print .env or .projects/vault. List variable names only, e.g. `sed -E 's/=.*/=<set>/' .env` or `stripe projects env`.");
if (/\bvercel\b[^;|&]*\s--token[\s=]/.test(cmd))
  decide("deny", "Do not pass the Vercel token as a flag (it lands in shell history). Export VERCEL_TOKEN and let the CLI read it.");
if (/\bgit\s+add\b[^;|&]*(\s-f\b|--force\b)/.test(cmd) && SECRET_FILE.test(cmd))
  decide("deny", "Do not force-add ignored secret files.");
if (/\bgit\s+commit\b/.test(cmd)) {
  if (/--no-verify\b/.test(cmd)) decide("ask", "--no-verify skips commit checks. Confirm with the user.");
  const problem = scanCommit(cmd);
  if (problem) decide("deny", problem);
}

process.exit(0);
