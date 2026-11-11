import { demoAgent } from "@/lib/buyer";
import { env } from "@/lib/env";
import { allowDemo, ensureSchema, sha256 } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SCHEMA = {
  type: "object",
  required: ["city", "temp_c", "conditions"],
  properties: { city: { type: "string" }, temp_c: { type: "number" }, conditions: { type: "string" } },
};

/**
 * Powers the "Run the demo" buttons. The server plays a real agent with its own
 * funded test wallet: it gets the 402, pays, and reports each step back.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const origin = env.publicOrigin() ?? new URL(request.url).origin;
  const scenario = new URL(request.url).searchParams.get("scenario") === "fail" ? "fail" : "pass";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!(await allowDemo(sha256(ip + env.mppSecret()).slice(0, 32)))) {
    return Response.json({ error: "rate_limited", message: "The demo is busy. Try again in a minute." }, { status: 429 });
  }

  const target = `${origin}/api/flaky?mode=${scenario === "pass" ? "ok" : "garbage"}`;
  const body = { url: target, contract: { status: 200, content_type: "application/json", json_schema: SCHEMA, max_latency_ms: 10000, max_price: "0.05" } };
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const agent = demoAgent();
  const t0 = Date.now();

  const first = await agent.rawFetch(`${origin}/api/call`, init);
  const challenge = await first.json().catch(() => ({}));
  if (first.status !== 402) return Response.json({ error: "unexpected", status: first.status, detail: challenge }, { status: 502 });
  const t1 = Date.now();

  const paid = await agent.fetch(`${origin}/api/call`, init);
  const outcome = await paid.json().catch(() => ({}));
  const t2 = Date.now();

  return Response.json({
    scenario,
    request: body,
    steps: [
      { step: "challenge", ms: t1 - t0, http: 402, quote: challenge.quote },
      { step: "paid", ms: t2 - t1, http: paid.status, receipt: Boolean(paid.headers.get("Payment-Receipt")) },
    ],
    outcome,
  });
}
