import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env";

function build(key: `0x${string}`) {
  return Mppx.create({ methods: [tempo({ account: privateKeyToAccount(key) })], polyfill: false });
}

let pool: ReturnType<typeof build> | null = null;
let demo: ReturnType<typeof build> | null = null;

/** Warranty as a paying customer of other MPP services (spends from the pool). */
export const buyer = () => (pool ??= build(env.warrantyKey()));
/** The demo agent that powers the "Run the demo" buttons. */
export const demoAgent = () => (demo ??= build(env.demoAgentKey()));

export type TargetOffer = { amount: bigint; currency: `0x${string}`; recipient?: string; method: string };

/** Reads the price out of a prepared payment's challenge. */
export function offerOf(challenge: { method: string; request: Record<string, unknown> }): TargetOffer | null {
  const r = challenge.request;
  if (typeof r.amount !== "string" || !/^\d+$/.test(r.amount) || typeof r.currency !== "string") return null;
  return { amount: BigInt(r.amount), currency: r.currency as `0x${string}`, recipient: r.recipient as string | undefined, method: challenge.method };
}
