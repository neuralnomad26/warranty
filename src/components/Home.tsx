"use client";

import { useCallback, useEffect, useState } from "react";

type Stats = {
  calls: number; passed: number; failed: number; refunds: number; refunded: string; covered_value: string;
  by_source: { agent: number; demo: number; scan: number };
  failure_reasons: { reason: string; n: number }[];
  recent: { id: string; at: string; source: string; host: string; verdict: string; failure_reason: string | null; paid: string; refund_tx: string | null }[];
};
type Service = { host: string; name: string; category: string | null; callable: boolean; note: string | null; n: number; passes: number; pass_rate: number | null; median_latency_ms: number | null; top_failure: string | null };
type Check = { name: string; ok: boolean; expected: string; actual: string };
type Demo = {
  scenario: "pass" | "fail";
  steps: [{ ms: number; quote?: { target_price: string; premium: string; total: string; covered: boolean; terms: string } }, { ms: number; http: number }];
  outcome: {
    id: string; verdict: "pass" | "fail"; failure_reason?: string; checks: Check[]; latency_ms: number;
    price: { target: string; premium: string; total: string };
    result?: { body: string } | null;
    target_receipt?: { reference?: string } | null;
    refund?: { amount: string; tx: string | null; status: string } | null;
    certificate?: { signature: string; signer: string };
  };
};

const short = (s?: string | null, n = 10) => (s ? `${s.slice(0, n)}…${s.slice(-6)}` : "");
const REASONS: Record<string, string> = {
  timeout: "Too slow or no answer", http_error: "Error status", wrong_content_type: "Wrong format", schema_mismatch: "Wrong shape",
  too_small: "Response too small", overcharge: "Charged more than quoted", no_receipt: "No payment receipt", payment_failed: "Payment not accepted",
};

export default function Home({ origin, network, wallet }: { origin: string; network: string; wallet: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [running, setRunning] = useState<"pass" | "fail" | null>(null);
  const [phase, setPhase] = useState(0);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, sc] = await Promise.all([fetch("/api/stats").then((r) => r.json()), fetch("/api/scores").then((r) => r.json())]);
      setStats(s);
      setServices(sc.services ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 8000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  async function run(scenario: "pass" | "fail") {
    setRunning(scenario);
    setDemo(null);
    setError(null);
    setPhase(1);
    const tick = setInterval(() => setPhase((p) => Math.min(p + 1, 4)), 1500);
    try {
      const res = await fetch(`/api/demo/run?scenario=${scenario}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.outcome?.verdict) throw new Error(json.message ?? "The demo call did not complete. Try again.");
      setDemo(json);
      setPhase(5);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase(0);
    } finally {
      clearInterval(tick);
      setRunning(null);
    }
  }

  const snippet = `npx mppx ${origin}/api/call --network testnet -J '{
  "url": "${origin}/api/flaky?mode=garbage",
  "contract": { "status": 200, "content_type": "application/json" }
}'`;

  const stepLabels = ["Agent asks Warranty to make the call", "Warranty answers 402 with a quote", "Agent pays Warranty", "Warranty pays the service", "Result checked against the contract"];

  return (
    <main className="mx-auto max-w-5xl px-5 pb-24 pt-10 sm:px-8">
      <header className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-400 text-zinc-950">W</span> Warranty
        </div>
        <nav className="flex gap-4 text-zinc-400">
          <a className="hover:text-white" href="/llms.txt">llms.txt</a>
          <a className="hover:text-white" href="/openapi.json">openapi.json</a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- JSON endpoint, not a page */}
          <a className="hover:text-white" href="/api/scores">scores</a>
        </nav>
      </header>

      <section className="pt-16">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">A refund layer for the Machine Payments Protocol</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          Agent payments are final. <span className="text-emerald-400">Warranty makes them safe to make.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-zinc-400">
          When an agent pays an MPP service in stablecoins, the money is gone, even if the service answers with an error, the wrong
          format, or nothing. Route the call through Warranty: it pays the service for you, checks the result against your contract,
          and refunds you automatically when a check fails.
        </p>
      </section>

      <section className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Calls checked", stats?.calls],
          ["Passed", stats?.passed],
          ["Refunds paid", stats?.refunds],
          ["Refunded", stats ? `$${stats.refunded}` : undefined],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-3xl font-bold tabular-nums">{value ?? "–"}</div>
            <div className="mt-1 text-sm text-zinc-400">{label}</div>
          </div>
        ))}
      </section>
      {stats && (
        <p className="mt-2 text-xs text-zinc-500">
          {network}. Of {stats.calls} calls: {stats.by_source.agent} from outside agents, {stats.by_source.demo} from the demo buttons below,{" "}
          {stats.by_source.scan} from the scanner. Amounts are test money.
        </p>
      )}

      <section className="mt-14 rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 sm:p-8">
        <h2 className="text-2xl font-bold">Watch it happen</h2>
        <p className="mt-2 max-w-2xl text-zinc-400">
          These buttons run a real agent with a funded test wallet against <code className="text-zinc-200">Flaky Weather</code>, a paid service
          built to break on request. Real payments move on Tempo testnet each time.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button disabled={!!running} onClick={() => run("pass")} className="rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-zinc-950 disabled:opacity-50">
            {running === "pass" ? "Running…" : "Buy from a service that works"}
          </button>
          <button disabled={!!running} onClick={() => run("fail")} className="rounded-xl bg-rose-500 px-5 py-3 font-semibold text-white disabled:opacity-50">
            {running === "fail" ? "Running…" : "Buy from a service that breaks"}
          </button>
        </div>

        {phase > 0 && (
          <ol className="mt-6 grid gap-2 sm:grid-cols-5">
            {stepLabels.map((label, i) => {
              const done = phase > i + 1 || phase === 5;
              const active = phase === i + 1 && phase !== 5;
              return (
                <li key={label} className={`rounded-xl border px-3 py-2 text-sm ${done ? "border-emerald-700 bg-emerald-500/10 text-emerald-200" : active ? "animate-pulse border-zinc-500 text-zinc-100" : "border-zinc-800 text-zinc-500"}`}>
                  <span className="mr-1 font-mono text-xs">{done ? "✓" : i + 1}</span> {label}
                </li>
              );
            })}
          </ol>
        )}
        {error && <p className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

        {demo && (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
              <div className="text-xs uppercase tracking-wider text-zinc-500">The money</div>
              <dl className="mt-3 space-y-2 text-sm">
                <Row k="Service price" v={`$${demo.outcome.price.target}`} />
                <Row k="Warranty premium" v={`$${demo.outcome.price.premium}`} />
                <Row k="Agent paid" v={`$${demo.outcome.price.total}`} strong />
                {demo.outcome.target_receipt?.reference && <Row k="Service's receipt" v={short(demo.outcome.target_receipt.reference)} mono />}
                {demo.outcome.refund?.tx && <Row k="Refund sent" v={`$${demo.outcome.refund.amount}`} strong good />}
                {demo.outcome.refund?.tx && <Row k="Refund transaction" v={short(demo.outcome.refund.tx)} mono />}
                {demo.outcome.refund && !demo.outcome.refund.tx && <Row k="Refund" v={demo.outcome.refund.status.replace(/_/g, " ")} />}
              </dl>
              <p className="mt-4 text-xs text-zinc-500">
                Took {((demo.steps[0].ms + demo.steps[1].ms) / 1000).toFixed(1)}s end to end. {demo.steps[0].quote?.terms}
              </p>
            </div>
            <div className={`rounded-2xl border p-5 ${demo.outcome.verdict === "pass" ? "border-emerald-700 bg-emerald-500/5" : "border-rose-700 bg-rose-500/5"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-zinc-500">The verdict</div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${demo.outcome.verdict === "pass" ? "bg-emerald-400 text-zinc-950" : "bg-rose-500 text-white"}`}>
                  {demo.outcome.verdict === "pass" ? "PASS" : `FAIL · ${REASONS[demo.outcome.failure_reason ?? ""] ?? demo.outcome.failure_reason}`}
                </span>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {demo.outcome.checks.map((c) => (
                  <li key={c.name} className="flex gap-2">
                    <span className={c.ok ? "text-emerald-400" : "text-rose-400"}>{c.ok ? "✓" : "✗"}</span>
                    <span className="text-zinc-300">{c.name.replace(/_/g, " ")}</span>
                    <span className="truncate text-zinc-500">{c.ok ? c.expected : `expected ${c.expected}, got ${c.actual}`}</span>
                  </li>
                ))}
              </ul>
              <a href={`/api/certificate/${demo.outcome.id}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-emerald-300 underline underline-offset-4">
                View the signed certificate
              </a>
            </div>
          </div>
        )}
      </section>

      <section className="mt-14">
        <h2 className="text-2xl font-bold">How it works</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          {[
            ["1. Quote", "Your agent sends the URL it wants to buy from and a contract. Warranty reads the service's price and answers 402 with that price plus a premium."],
            ["2. Pay once", "Your agent pays Warranty. Warranty pays the service from its own pool and collects the service's receipt."],
            ["3. Check", "Status, format, JSON shape, size, speed, receipt and price are checked against your contract."],
            ["4. Result or refund", "Pass: you get the result and a signed certificate. Fail: the full amount goes back to your wallet, with the reason."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="font-semibold">{t}</div>
              <p className="mt-2 text-sm text-zinc-400">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-sm text-zinc-400">
          The premium follows each service&apos;s track record: the more often it has failed, the more it costs to cover. So the price in
          the 402 is itself a reliability signal an agent can read before spending anything.
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-2xl font-bold">Reliability scoreboard</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Pass rate over the last 7 days of calls through Warranty. Always read it with the number of calls. No hidden formula.
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Service</th><th className="px-4 py-3">Pass rate</th><th className="px-4 py-3">Calls</th>
                <th className="px-4 py-3">Median time</th><th className="px-4 py-3">Most common failure</th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-zinc-500">No calls recorded yet. Run the demo above.</td></tr>
              )}
              {services.map((s) => (
                <tr key={s.host} className="border-t border-zinc-800">
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-zinc-500">{s.host}{s.category ? ` · ${s.category}` : ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    {s.pass_rate === null ? <span className="text-zinc-500">{s.callable ? "not scanned yet" : "not scanned"}</span> : (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-800">
                          <div className={`h-full ${s.pass_rate >= 0.9 ? "bg-emerald-400" : s.pass_rate >= 0.5 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${s.pass_rate * 100}%` }} />
                        </div>
                        <span className="tabular-nums">{Math.round(s.pass_rate * 100)}%</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{s.n}</td>
                  <td className="px-4 py-3 tabular-nums">{s.median_latency_ms ? `${(s.median_latency_ms / 1000).toFixed(1)}s` : "–"}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.top_failure ? REASONS[s.top_failure] ?? s.top_failure : s.note ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-14 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold">Use it from your agent</h2>
          <p className="mt-2 text-sm text-zinc-400">One request. No sign-up and no API key: the payment is the authentication.</p>
          <pre className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-300">{snippet}</pre>
          <p className="mt-3 text-sm text-zinc-400">
            Agents can read the full guide at <a className="text-emerald-300 underline underline-offset-4" href="/llms.txt">/llms.txt</a>.
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold">Honest limits</h2>
          <ul className="mt-4 space-y-3 text-sm text-zinc-400">
            <li><b className="text-zinc-200">It checks form, not truth.</b> Status, format, shape, size, speed, price and receipt can be checked automatically. Whether the data is correct cannot.</li>
            <li><b className="text-zinc-200">Test money.</b> The pool and every refund are on {network} until this moves to mainnet.</li>
            <li><b className="text-zinc-200">New services are checked, not covered.</b> A service needs a track record before failures are refunded. Otherwise anyone could run a broken service and collect refunds on it.</li>
            <li><b className="text-zinc-200">Small numbers.</b> Scores come from few calls so far. Read the call count next to every percentage.</li>
          </ul>
        </div>
      </section>

      {stats && stats.recent.length > 0 && (
        <section className="mt-14">
          <h2 className="text-2xl font-bold">Latest calls</h2>
          <ul className="mt-4 divide-y divide-zinc-800 rounded-2xl border border-zinc-800 text-sm">
            {stats.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className={`w-12 font-bold ${r.verdict === "pass" ? "text-emerald-400" : "text-rose-400"}`}>{r.verdict.toUpperCase()}</span>
                <span className="text-zinc-300">{r.host}</span>
                <span className="text-zinc-500">${r.paid} · {r.source}</span>
                {r.failure_reason && <span className="text-zinc-400">{REASONS[r.failure_reason] ?? r.failure_reason}</span>}
                {r.refund_tx && <span className="font-mono text-xs text-emerald-300">refunded {short(r.refund_tx, 8)}</span>}
                <a className="ml-auto text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-300" href={`/api/certificate/${r.id}`} target="_blank" rel="noreferrer">certificate</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-16 border-t border-zinc-800 pt-6 text-xs text-zinc-500">
        Warranty wallet (signs certificates, pays refunds): <span className="font-mono">{wallet}</span>. Built on MPP with mppx, deployed with Stripe Projects.
      </footer>
    </main>
  );
}

function Row({ k, v, strong, mono, good }: { k: string; v: string; strong?: boolean; mono?: boolean; good?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-400">{k}</dt>
      <dd className={`${strong ? "font-bold" : ""} ${mono ? "font-mono text-xs" : ""} ${good ? "text-emerald-300" : "text-zinc-100"}`}>{v}</dd>
    </div>
  );
}
