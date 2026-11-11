import { verifyMessage } from "viem";
import { env } from "./env";
import { warrantyAccount } from "./tempo";

export type CertificateBody = Record<string, unknown> & { id: string };
export type Certificate = { body: CertificateBody; signer: string; signature: string };

/** Stable text form of the certificate body: keys sorted at every level. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Signs with the Warranty wallet, so anyone can verify a certificate against its public address. */
export async function sign(body: CertificateBody): Promise<Certificate> {
  const signature = await warrantyAccount().signMessage({ message: canonical(body) });
  return { body, signer: env.warrantyAddress(), signature };
}

export async function verify(cert: Certificate): Promise<boolean> {
  try {
    return await verifyMessage({ address: cert.signer as `0x${string}`, message: canonical(cert.body), signature: cert.signature as `0x${string}` });
  } catch {
    return false;
  }
}
