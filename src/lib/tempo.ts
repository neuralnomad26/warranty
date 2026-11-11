import { createClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempo as tempoMainnet, tempoModerato } from "viem/chains";
import { Actions } from "viem/tempo";
import { env } from "./env";

type Hex = `0x${string}`;

export const warrantyAccount = () => privateKeyToAccount(env.warrantyKey());

function client(token: Hex) {
  const base = env.testnet() ? tempoModerato : tempoMainnet;
  // Tempo has no native gas coin: fees are paid in a stablecoin, here the same one being moved.
  return createClient({ account: warrantyAccount(), chain: base.extend({ feeToken: token }), transport: http() });
}

/** Sends `units` of `token` from the pool to `to` and waits for it to land. Returns the transaction hash. */
export async function refund(to: Hex, units: bigint, token: Hex): Promise<string> {
  const res = (await Actions.token.transferSync(client(token), { to, amount: units, token })) as {
    receipt?: { transactionHash?: string };
    transactionHash?: string;
  };
  const hash = res.receipt?.transactionHash ?? res.transactionHash;
  if (!hash) throw new Error("refund sent but no transaction hash was returned");
  return hash;
}

const balances = new Map<string, { at: number; units: bigint }>();

/** Pool balance in `token`, cached briefly so quotes stay fast. */
export async function poolBalance(token: Hex): Promise<bigint> {
  const hit = balances.get(token);
  if (hit && Date.now() - hit.at < 20_000) return hit.units;
  const raw = (await Actions.token.getBalance(client(token), { account: env.warrantyAddress(), token })) as unknown;
  const units = typeof raw === "bigint" ? raw : BigInt((raw as { value?: bigint; amount?: bigint }).value ?? (raw as { amount?: bigint }).amount ?? 0n);
  balances.set(token, { at: Date.now(), units });
  return units;
}

export const forgetBalance = (token: Hex) => balances.delete(token);
