import { Credential } from "mppx";
import { Mppx, Store, tempo } from "mppx/server";
import { db } from "./db";
import { env } from "./env";

// The verified payer is only reported through the payment.success event, so
// remember it against the request object that is being served.
const payers = new WeakMap<object, string>();

function build() {
  const mppx = Mppx.create({
    methods: [
      tempo.charge({
        recipient: env.warrantyAddress(),
        testnet: env.testnet(),
        // Replay protection must be shared by every serverless instance.
        store: Store.postgres(db()),
      }),
    ],
    realm: env.realm(),
    secretKey: env.mppSecret(),
  });
  mppx.on("payment.success", (ctx) => {
    if (ctx.payer && ctx.input && typeof ctx.input === "object") payers.set(ctx.input as object, ctx.payer);
  });
  return mppx;
}

let instance: ReturnType<typeof build> | null = null;

/** Server-side MPP handler: issues 402 challenges and verifies payments. */
export function mpp() {
  return (instance ??= build());
}

/**
 * Payer address for the payment that settled on this request.
 *
 * Call only after charge() has returned status 200: by then the method has verified
 * that the transfer really came from the credential's source, so the source is safe to refund.
 */
export function payerOf(request: Request): string | undefined {
  const seen = payers.get(request);
  if (seen) return seen;
  try {
    const source = Credential.fromRequest(request).source; // did:pkh:eip155:<chain>:<address>
    const address = source?.split(":").pop();
    return address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : undefined;
  } catch {
    return undefined;
  }
}
