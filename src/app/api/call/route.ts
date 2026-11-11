import { MIN_PREMIUM } from "@/lib/config";
import { BadRequest, parseCallRequest, type CallRequest } from "@/lib/contract";
import { execute, prepare, quoteJson, Reject } from "@/lib/engine";
import { env } from "@/lib/env";
import { fromUnits } from "@/lib/money";
import { mpp, payerOf } from "@/lib/mpp";
import { ensureSchema, trustSelf } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const isText = (ct: string) => /^(text\/|application\/(json|xml|.*\+json|.*\+xml|javascript|x-www-form-urlencoded))/i.test(ct);


/**
 * There is nothing to buy (no usable body or URL). Answer with the 402 that discovery tools
 * expect, priced at the minimum, and say what is wrong. Any credential is dropped first, so a
 * caller with a broken request can never be charged for it.
 */
async function discoveryChallenge(request: Request, message: string, selfOrigin: string) {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("payment-authorization");
  const bare = new Request(request.url, { method: "POST", headers });
  const probe = await mpp().charge({
    amount: MIN_PREMIUM,
    description: "Warranty covered call. Price = the target's price + a premium. POST {url, contract} for an exact quote.",
  })(bare);
  if (probe.status !== 402) return Response.json({ error: "bad_request", message }, { status: 400 });
  const out = new Headers(probe.challenge.headers);
  out.set("Content-Type", "application/json");
  const problem = await probe.challenge.json().catch(() => ({}));
  return new Response(JSON.stringify({ ...problem, error: "bad_request", message, charged: false, docs: `${selfOrigin}/llms.txt` }), { status: 402, headers: out });
}

/**
 * POST /api/call: a covered call to another MPP service.
 *
 * Unpaid request: Warranty reads the target's price and answers 402 for that price plus a premium.
 * Paid request:   Warranty pays the target itself, checks the result against the caller's contract,
 *                 and returns the result with a signed certificate, or refunds the caller.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const selfOrigin = env.publicOrigin() ?? new URL(request.url).origin;
  await trustSelf(new URL(selfOrigin).host);

  let call: CallRequest;
  try {
    call = parseCallRequest(await request.clone().json().catch(() => null));
  } catch (e) {
    if (!(e instanceof BadRequest)) throw e;
    return discoveryChallenge(request, e.message, selfOrigin);
  }

  let prepared;
  try {
    prepared = await prepare(call, selfOrigin);
  } catch (e) {
    if (e instanceof Reject && e.code === "bad_url") return discoveryChallenge(request, e.message, selfOrigin);
    if (e instanceof Reject) return Response.json({ error: e.code, message: e.message, charged: false, ...e.extra }, { status: e.status });
    throw e;
  }
  const quote = quoteJson(prepared);

  const charge = await mpp().charge({
    amount: fromUnits(prepared.totalUnits),
    description: `Warranty: ${prepared.terms.covered ? "covered" : "checked"} call to ${prepared.host} (${quote.target_price} + ${quote.premium} premium)`,
  })(request);
  if (charge.status === 402) {
    const headers = new Headers(charge.challenge.headers);
    headers.set("X-Warranty-Quote", JSON.stringify(quote));
    headers.set("Content-Type", "application/json");
    const problem = await charge.challenge.json().catch(() => ({}));
    return new Response(JSON.stringify({ ...problem, quote }), { status: 402, headers });
  }

  const paid = charge.challenge?.request as { currency?: string } | undefined;
  const payer = payerOf(request);
  const done = await execute(prepared, {
    source: payer && payer.toLowerCase() === env.demoAgentAddress().toLowerCase() ? "demo" : "agent",
    payer,
    paidCurrency: paid?.currency,
    paidUnits: prepared.totalUnits,
  });

  const common = {
    id: done.id,
    verdict: done.verdict,
    covered: done.covered,
    price: { target: quote.target_price, premium: quote.premium, total: quote.total },
    latency_ms: done.latencyMs,
    checks: done.checks,
    target_receipt: done.targetReceipt,
    certificate: done.certificate,
    certificate_url: `${selfOrigin}/api/certificate/${done.id}`,
  };

  if (done.verdict === "pass" && done.result) {
    const text = isText(done.result.contentType);
    return charge.withReceipt(
      Response.json({
        ...common,
        result: {
          status: done.result.status,
          content_type: done.result.contentType,
          encoding: text ? "utf8" : "base64",
          body: text ? new TextDecoder().decode(done.result.bytes) : Buffer.from(done.result.bytes).toString("base64"),
        },
      }),
    );
  }
  // The purchase failed. 502 tells naive callers not to treat this as data; the body says what happened to the money.
  return charge.withReceipt(Response.json({ ...common, failure_reason: done.failureReason, refund: done.refund, result: null }, { status: 502 }));
}
