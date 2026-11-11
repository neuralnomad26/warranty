import { verify, type Certificate } from "@/lib/certificate";
import { ensureSchema, getCall } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Public: look up a certificate and check its signature against the Warranty wallet. */
export async function GET(_req: Request, ctx: RouteContext<"/api/certificate/[id]">) {
  await ensureSchema();
  const { id } = await ctx.params;
  const call = await getCall(id);
  if (!call?.certificate) return Response.json({ error: "not_found" }, { status: 404 });
  const certificate = call.certificate as Certificate;
  return Response.json({
    signature_valid: await verify(certificate),
    how_to_verify: "The signature is an EIP-191 personal_sign over the certificate body serialised as JSON with keys sorted at every level, by the address in `signer`.",
    certificate,
  });
}
