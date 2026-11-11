/** Product rules in one place. Amounts are decimal strings in the payment token (USD stablecoin). */
export const FLAKY_PRICE = "0.01";
/** Most Warranty will cover on a single call. */
export const COVERAGE_CAP = "1";
/** Premium floor, also the flat inspection fee when a target is checked but not covered. */
export const MIN_PREMIUM = "0.005";
/** Premium is at least this share of the target's price. */
export const BASE_PREMIUM_RATE = 0.1;
/** Margin applied on top of a target's observed failure rate. */
export const RISK_MARGIN = 1.25;
/** A target is covered once it has this many recorded calls and this pass rate. */
export const TRUST_MIN_CALLS = 5;
export const TRUST_MIN_PASS_RATE = 0.5;
/** Refunds one payer can receive in 24 hours. Limits the "own a broken service" exploit. */
export const MAX_REFUNDS_PER_PAYER_PER_DAY = 25;
export const QUOTE_TTL_SECONDS = 60;
export const DEFAULT_MAX_LATENCY_MS = 10_000;
export const HARD_MAX_LATENCY_MS = 25_000;
export const MAX_RESULT_BYTES = 2 * 1024 * 1024;
export const SCORE_WINDOW_DAYS = 7;
