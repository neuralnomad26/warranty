import { BadRequest, parseCallRequest } from "@/lib/contract";
import { prepare, quoteJson, Reject } from "@/lib/engine";
import { env } from "@/lib/env";
import { ensureSchema, trustSelf } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Free: what Warranty would charge to cover a GET to this target right now. */
export async function GET(request: Request) {
  await ensureSchema();
  const selfOrigin = env.publicOrigin() ?? new URL(request.url).origin;
  await trustSelf(new URL(selfOrigin).host);
  const url = new URL(request.url).searchParams.get("url");
  try {
    const prepared = await prepare(parseCallRequest({ url, method: "GET", contract: {} }), selfOrigin);
    return Response.json(quoteJson(prepared));
  } catch (e) {
    if (e instanceof Reject) return Response.json({ error: e.code, message: e.message, ...e.extra }, { status: e.status });
    if (e instanceof BadRequest) return Response.json({ error: "bad_request", message: e.message }, { status: 400 });
    throw e;
  }
}
