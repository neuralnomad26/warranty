import { fromUnits } from "@/lib/money";
import { ensureSchema, hostHistory } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/scores/[host]">) {
  await ensureSchema();
  const host = decodeURIComponent((await ctx.params).host);
  const rows = await hostHistory(host);
  return Response.json({
    host,
    calls: rows.map((r) => ({
      id: r.id, at: r.created_at, source: r.source, verdict: r.verdict, failure_reason: r.failure_reason, latency_ms: r.latency_ms,
      covered: r.covered, target_price: fromUnits(r.quoted_units), paid: fromUnits(r.total_units),
      refunded: r.refund_units ? fromUnits(r.refund_units) : null, refund_tx: r.refund_tx,
    })),
  });
}
