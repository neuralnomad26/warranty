import { SCORE_WINDOW_DAYS } from "@/lib/config";
import { ensureSchema, scores } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Public: reliability of every MPP service Warranty has called. No hidden formula. */
export async function GET() {
  await ensureSchema();
  return Response.json({
    window_days: SCORE_WINDOW_DAYS,
    method: "pass_rate = calls that met their contract / all calls through Warranty in the window. Always read it with n.",
    services: await scores(),
  });
}
