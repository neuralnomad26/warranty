import {
  BASE_PREMIUM_RATE, MIN_PREMIUM, RISK_MARGIN, TRUST_MIN_CALLS, TRUST_MIN_PASS_RATE,
} from "./config";
import { maxUnits, scaleUp, toUnits } from "./money";
import type { HostStats } from "./store";

export type Terms = { covered: boolean; premiumUnits: bigint; failureRate: number | null; why: string };

/**
 * Decides whether a target is covered and what the premium is.
 *
 * Covered targets: the premium follows the target's observed failure rate, so an
 * unreliable service is expensive to insure and the 402 price says so.
 * Unknown targets: Warranty still pays, checks and certifies, but does not refund,
 * and charges only a flat inspection fee. Without this rule anyone could put up a
 * broken service, call it through Warranty and collect refunds.
 */
export function termsFor(targetUnits: bigint, stats: HostStats): Terms {
  const floor = toUnits(MIN_PREMIUM);
  const passRate = stats.n > 0 ? stats.passes / stats.n : 0;
  const hasRecord = stats.n >= TRUST_MIN_CALLS && passRate >= TRUST_MIN_PASS_RATE;
  if (!stats.trusted && !hasRecord) {
    return {
      covered: false,
      premiumUnits: floor,
      failureRate: stats.n ? 1 - passRate : null,
      why: stats.n < TRUST_MIN_CALLS
        ? `Not covered yet: ${stats.n} recorded calls, ${TRUST_MIN_CALLS} needed. Checked and certified, no refund.`
        : `Not covered: pass rate ${(passRate * 100).toFixed(0)}% is below ${TRUST_MIN_PASS_RATE * 100}%. Checked and certified, no refund.`,
    };
  }
  // Laplace-smoothed failure rate, so a short record never reads as 0% or 100%.
  const failureRate = (stats.n - stats.passes + 1) / (stats.n + 2);
  const premiumUnits = maxUnits(floor, scaleUp(targetUnits, BASE_PREMIUM_RATE), scaleUp(targetUnits, failureRate * RISK_MARGIN));
  return { covered: true, premiumUnits, failureRate, why: `Covered: full refund if a check fails. Premium reflects a ${(failureRate * 100).toFixed(0)}% observed failure rate.` };
}
