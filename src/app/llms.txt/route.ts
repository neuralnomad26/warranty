import { COVERAGE_CAP, MAX_REFUNDS_PER_PAYER_PER_DAY, MIN_PREMIUM, TRUST_MIN_CALLS, TRUST_MIN_PASS_RATE } from "@/lib/config";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const o = env.publicOrigin() ?? new URL(request.url).origin;
  const text = `# Warranty

> A money-back guarantee for MPP payments. Stablecoin payments are final, so an agent that pays a service and gets an error or the wrong format has no recourse. Call the service through Warranty instead: it pays for you, checks the result against your contract, and refunds you automatically when a covered service fails.

Network: ${env.testnet() ? "Tempo testnet (test funds only)" : "Tempo mainnet"}. Payment method: MPP, tempo charge.

## Make a covered call

POST ${o}/api/call  (paid, MPP)

Body (JSON):
{
  "url": "https://service.example/api/thing?x=1",   // the MPP endpoint you want to buy from
  "method": "GET",                                   // or "POST", with "body" and "headers"
  "contract": {
    "status": 200,                    // expected HTTP status (default 200)
    "content_type": "application/json", // optional, prefix match
    "json_schema": { },               // optional JSON Schema the body must satisfy
    "min_bytes": 1000,                // optional
    "max_latency_ms": 10000,          // default 10000, max 25000
    "max_price": "0.05"               // optional: refuse if the service quotes more
  }
}

Flow:
1. Send the request with no payment. You get HTTP 402 with a \`WWW-Authenticate: Payment\` challenge. The JSON body and the \`X-Warranty-Quote\` header carry the quote: target_price, premium, total, covered.
2. Pay the challenge and resend the same body within 60 seconds.
3. PASS: HTTP 200 with \`result\` (the service's response), \`target_receipt\`, and a signed \`certificate\`.
   FAIL: HTTP 502 with \`failure_reason\`, the failed \`checks\`, and \`refund\` (amount and transaction hash).

Warranty always checks, in addition to your contract: a valid payment receipt came back, and the amount charged was no more than the amount quoted.

Failure reasons: timeout, http_error, wrong_content_type, schema_mismatch, too_small, overcharge, no_receipt, payment_failed.

## Price

total = the service's own price + a premium.
- Covered services: premium = the larger of ${MIN_PREMIUM}, 10% of the price, or the service's observed failure rate x 1.25 x the price. An unreliable service costs more to cover.
- Services without a track record (fewer than ${TRUST_MIN_CALLS} recorded calls, or a pass rate under ${TRUST_MIN_PASS_RATE * 100}%): Warranty still pays, checks and certifies the call for a flat ${MIN_PREMIUM} fee, but does NOT refund. The quote says \`"covered": false\`.
- If the service cannot be reached or does not ask for payment, the request is rejected and you are not charged.

## Limits

- Coverage cap: ${COVERAGE_CAP} per call.
- At most ${MAX_REFUNDS_PER_PAYER_PER_DAY} refunds per paying wallet per 24 hours. Beyond that, calls are checked but not refunded.
- Warranty checks what can be checked automatically (status, format, schema, size, speed, price, receipt). It cannot tell whether the data is true.
- Refunds are sent to the wallet that paid, in the token it paid with.

## Free endpoints

- GET ${o}/api/quote?url=<target>        what a covered GET to that target would cost now
- GET ${o}/api/certificate/<id>          verify a certificate
- GET ${o}/api/scores                    reliability of every service Warranty has called
- GET ${o}/api/scores/<host>             one service's recent calls
- GET ${o}/api/stats                     totals: calls, refunds, failure reasons
- GET ${o}/openapi.json                  machine-readable description with x-payment-info

## Try it

A demo service that fails on request (paid, 0.01):
  GET ${o}/api/flaky?mode=ok|garbage|slow|error|random

  npx mppx ${o}/api/call --network testnet -J '{"url":"${o}/api/flaky?mode=garbage","contract":{"content_type":"application/json"}}'
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
