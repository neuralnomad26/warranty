import { randomUUID } from "node:crypto";
import { Receipt } from "mppx";
import { buyer, offerOf, type TargetOffer } from "./buyer";
import { canonical, sign, type Certificate } from "./certificate";
import { COVERAGE_CAP, MAX_REFUNDS_PER_PAYER_PER_DAY, MAX_RESULT_BYTES, QUOTE_TTL_SECONDS } from "./config";
import { runChecks, type CallRequest, type Check, type FailureReason, type Outcome } from "./contract";
import { termsFor, type Terms } from "./coverage";
import { env } from "./env";
import { fromUnits, toUnits } from "./money";
import { assertPublicUrl } from "./ssrf";
import { getQuote, hostStats, insertCall, putQuote, refundsToday, sha256 } from "./store";
import { forgetBalance, poolBalance, refund } from "./tempo";

/** A request Warranty will not take on. Raised before any money moves. */
export class Reject extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const timeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(label)), ms))]);

type PreparedPayment = { challenge: { method: string; request: Record<string, unknown> }; pay: () => Promise<Response> };

export type Prepared = {
  call: CallRequest;
  url: URL;
  host: string;
  payment: PreparedPayment;
  offer: TargetOffer;
  terms: Terms;
  totalUnits: bigint;
  quoteKey: string;
};

/**
 * Step 1: ask the target what it charges, without paying, and work out
 * Warranty's own price. Throws Reject if the target cannot be bought safely.
 */
export async function prepare(call: CallRequest, selfOrigin: string): Promise<Prepared> {
  let url: URL;
  try {
    url = await assertPublicUrl(call.url, selfOrigin);
  } catch (e) {
    throw new Reject(400, "bad_url", e instanceof Error ? e.message : "url is not allowed");
  }
  const init: RequestInit = { method: call.method, headers: call.headers, body: call.body };

  let probe;
  try {
    probe = await timeout(buyer().prepareRequest(url, init), 10_000, "probe timeout");
  } catch (e) {
    throw new Reject(502, "target_unreachable", `Could not reach the target to read its price (${e instanceof Error ? e.message : "error"}). You were not charged.`);
  }
  if (!probe.payment) {
    throw new Reject(422, "target_not_paid", `The target answered ${probe.response.status} without asking for payment, so there is nothing to cover. Call it directly. You were not charged.`);
  }
  const payment = probe.payment as unknown as PreparedPayment;
  const offer = offerOf(payment.challenge);
  if (!offer || offer.method !== "tempo") {
    throw new Reject(422, "unsupported_payment", "The target's payment terms are not ones Warranty can pay (Tempo charge only for now). You were not charged.");
  }
  if (offer.amount > toUnits(COVERAGE_CAP)) {
    throw new Reject(422, "over_cap", `The target quotes ${fromUnits(offer.amount)}, above the ${COVERAGE_CAP} coverage cap. You were not charged.`);
  }
  if (call.contract.max_price !== undefined && offer.amount > toUnits(call.contract.max_price)) {
    throw new Reject(409, "over_max_price", `The target quotes ${fromUnits(offer.amount)}, above your max_price of ${call.contract.max_price}. You were not charged.`, { quoted: fromUnits(offer.amount) });
  }
  if ((await poolBalance(offer.currency).catch(() => 0n)) < offer.amount) {
    throw new Reject(503, "pool_low", "Warranty's pool cannot fund this call right now. You were not charged.");
  }

  // Reuse the quote for 60s so the price in the 402 and in the paid retry match.
  const quoteKey = sha256(canonical({ url: url.toString(), method: call.method, headers: call.headers, body: call.body ?? null, contract: call.contract }));
  let quote = await getQuote(quoteKey);
  let terms = termsFor(offer.amount, await hostStats(url.host));
  if (quote && quote.targetUnits === offer.amount) {
    terms = { ...terms, covered: quote.covered, premiumUnits: quote.premiumUnits };
  } else {
    quote = { targetUnits: offer.amount, premiumUnits: terms.premiumUnits, covered: terms.covered };
    await putQuote(quoteKey, quote, QUOTE_TTL_SECONDS);
  }
  return { call, url, host: url.host, payment, offer, terms, totalUnits: offer.amount + terms.premiumUnits, quoteKey };
}

export function quoteJson(p: Prepared) {
  return {
    quote_id: p.quoteKey.slice(0, 24),
    valid_for_seconds: QUOTE_TTL_SECONDS,
    target: p.url.toString(),
    target_price: fromUnits(p.offer.amount),
    premium: fromUnits(p.terms.premiumUnits),
    total: fromUnits(p.totalUnits),
    covered: p.terms.covered,
    observed_failure_rate: p.terms.failureRate === null ? null : Number(p.terms.failureRate.toFixed(3)),
    terms: p.terms.why,
  };
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.length > MAX_RESULT_BYTES ? buf.slice(0, MAX_RESULT_BYTES) : buf;
}

export type Executed = {
  id: string;
  verdict: "pass" | "fail";
  covered: boolean;
  failureReason: FailureReason | null;
  checks: Check[];
  latencyMs: number;
  result: { status: number; contentType: string; bytes: Uint8Array } | null;
  targetReceipt: Record<string, unknown> | null;
  refund: { amount: string; tx: string | null; status: "sent" | "failed" | "not_covered" | "limit_reached" | "no_payer"; error?: string } | null;
  certificate: Certificate;
};

/**
 * Step 2, after the agent has paid Warranty: pay the target, check the result
 * against the contract, refund on failure, sign a certificate, record the call.
 */
export async function execute(
  p: Prepared,
  who: { source: "agent" | "demo" | "scan"; payer?: string; paidCurrency?: string; paidUnits: bigint },
): Promise<Executed> {
  const { contract } = p.call;
  const id = randomUUID();
  const started = Date.now();
  let outcome: Outcome;
  let result: Executed["result"] = null;
  let targetReceipt: Record<string, unknown> | null = null;
  let paidTarget = false;

  try {
    const { res, bytes } = await timeout(
      (async () => {
        const r = await p.payment.pay();
        return { res: r, bytes: await readCapped(r) };
      })(),
      contract.max_latency_ms + 2_000,
      "timeout",
    );
    const latencyMs = Date.now() - started;
    paidTarget = res.status !== 402;
    const header = res.headers.get("Payment-Receipt");
    if (header) {
      try {
        targetReceipt = Receipt.deserialize(header) as unknown as Record<string, unknown>;
      } catch {}
    }
    const contentType = res.headers.get("Content-Type") ?? "";
    result = { status: res.status, contentType, bytes };
    outcome = res.status === 402
      ? { transport: "payment_failed", latencyMs, quotedUnits: p.offer.amount, chargedUnits: 0n }
      : { status: res.status, contentType, bytes, latencyMs, receipt: targetReceipt as Outcome["receipt"], quotedUnits: p.offer.amount, chargedUnits: p.offer.amount };
  } catch (e) {
    const timedOut = e instanceof Error && e.message === "timeout";
    // On a timeout the payment may already have gone through, so assume it did.
    paidTarget = timedOut;
    outcome = { transport: timedOut ? "timeout" : "payment_failed", latencyMs: Date.now() - started, quotedUnits: p.offer.amount, chargedUnits: timedOut ? p.offer.amount : 0n };
  }
  forgetBalance(p.offer.currency);

  const { checks, reason } = runChecks(contract, outcome);
  const verdict = reason ? "fail" : "pass";

  let refundInfo: Executed["refund"] = null;
  if (verdict === "fail" && who.paidUnits > 0n) {
    const amount = fromUnits(who.paidUnits);
    if (!p.terms.covered) refundInfo = { amount: "0", tx: null, status: "not_covered" };
    else if (!who.payer || !who.paidCurrency) refundInfo = { amount, tx: null, status: "no_payer" };
    else if ((await refundsToday(who.payer)) >= MAX_REFUNDS_PER_PAYER_PER_DAY) refundInfo = { amount: "0", tx: null, status: "limit_reached" };
    else {
      try {
        const tx = await refund(who.payer as `0x${string}`, who.paidUnits, who.paidCurrency as `0x${string}`);
        refundInfo = { amount, tx, status: "sent" };
      } catch (e) {
        refundInfo = { amount, tx: null, status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "refund failed" };
      }
    }
  }

  const certificate = await sign({
    id,
    issued_at: new Date().toISOString(),
    issuer: "Warranty",
    network: env.testnet() ? "tempo-testnet" : "tempo",
    target: { url: p.url.toString(), host: p.host, method: p.call.method },
    payer: who.payer ?? null,
    price: { target: fromUnits(p.offer.amount), premium: fromUnits(who.paidUnits > 0n ? p.terms.premiumUnits : 0n), total: fromUnits(who.paidUnits), currency: who.paidCurrency ?? p.offer.currency },
    covered: p.terms.covered,
    verdict,
    failure_reason: reason,
    checks,
    latency_ms: outcome.latencyMs,
    target_receipt: targetReceipt,
    result_sha256: result ? sha256(result.bytes) : null,
    refund: refundInfo ? { amount: refundInfo.amount, tx: refundInfo.tx, status: refundInfo.status } : null,
  });

  await insertCall({
    id, source: who.source, payer: who.payer ?? null, target_host: p.host, url: p.url.toString(), method: p.call.method,
    currency: who.paidCurrency ?? p.offer.currency, quoted_units: p.offer.amount,
    premium_units: who.paidUnits > 0n ? p.terms.premiumUnits : 0n, total_units: who.paidUnits, covered: p.terms.covered,
    paid_target: paidTarget, target_receipt: targetReceipt, latency_ms: outcome.latencyMs, checks, verdict,
    failure_reason: reason, refund_units: refundInfo?.status === "sent" ? who.paidUnits : null, refund_tx: refundInfo?.tx ?? null,
    refund_error: refundInfo?.error ?? null, certificate,
  });

  return { id, verdict, covered: p.terms.covered, failureReason: reason, checks, latencyMs: outcome.latencyMs, result, targetReceipt, refund: refundInfo, certificate };
}
