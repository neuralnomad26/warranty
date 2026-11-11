import { fromUnits } from "@/lib/money";
import { ensureSchema, totals } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Public counters for the home page. Demo and scanner calls are counted separately from real agents. */
export async function GET() {
  await ensureSchema();
  const t = await totals();
  return Response.json({
    calls: t.calls, passed: t.passed, failed: t.failed, refunds: t.refunds,
    refunded: fromUnits(t.refunded_units), covered_value: fromUnits(t.covered_units),
    by_source: { agent: t.agent_calls, demo: t.demo_calls, scan: t.scan_calls },
    failure_reasons: t.failure_reasons,
    recent: t.recent.map((r: Record<string, string | null>) => ({
      id: r.id, at: r.created_at, source: r.source, host: r.target_host, verdict: r.verdict,
      failure_reason: r.failure_reason, paid: fromUnits(r.total_units ?? "0"), refund_tx: r.refund_tx,
    })),
  });
}
