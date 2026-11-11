/** TIP-20 stablecoins on Tempo use 6 decimals. */
export const DECIMALS = 6;
const SCALE = 10n ** BigInt(DECIMALS);

/** "0.015" -> 15000n. Throws on anything that is not a plain non-negative decimal. */
export function toUnits(value: string | number): bigint {
  const s = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Not a decimal amount: ${s}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * SCALE + BigInt((frac + "000000").slice(0, DECIMALS));
}

/** 15000n -> "0.015" */
export function fromUnits(units: bigint | string | number): string {
  const u = BigInt(units);
  const whole = u / SCALE;
  const frac = (u % SCALE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Multiply an amount by a ratio, rounding up to the next base unit. */
export function scaleUp(units: bigint, ratio: number): bigint {
  const ppm = BigInt(Math.ceil(ratio * 1_000_000));
  return (units * ppm + 999_999n) / 1_000_000n;
}

export const maxUnits = (...xs: bigint[]) => xs.reduce((a, b) => (b > a ? b : a));
