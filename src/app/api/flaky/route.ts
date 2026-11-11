import { env } from "@/lib/env";
import { mpp } from "@/lib/mpp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FLAKY_PRICE = "0.01";
const MODES = ["ok", "garbage", "slow", "error", "random"] as const;
type Mode = (typeof MODES)[number];

/**
 * A real paid MPP service that misbehaves on request. It exists so Warranty has
 * something honest to fail against: it always takes the money first.
 *
 *   ?mode=ok       correct JSON
 *   ?mode=garbage  200, but HTML instead of the promised JSON
 *   ?mode=slow     correct JSON after 12 seconds
 *   ?mode=error    500 after taking payment
 *   ?mode=random   fails about half the time
 *   (no mode)      same as ok, so discovery tools and validators see a working service
 */
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("mode") as Mode | null;
  const result = await mpp().charge({
    amount: FLAKY_PRICE,
    recipient: env.flakyAddress(),
    description: "Flaky Weather: one forecast (demo service that sometimes breaks)",
  })(request);
  if (result.status === 402) return result.challenge;

  let mode: Mode = asked && MODES.includes(asked) ? asked : "ok";
  if (mode === "random") mode = Math.random() < 0.5 ? "ok" : Math.random() < 0.5 ? "garbage" : "error";

  if (mode === "error") return Response.json({ error: "internal error" }, { status: 500 });
  if (mode === "garbage") {
    return result.withReceipt(
      new Response("<html><body><h1>Service temporarily unavailable</h1></body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );
  }
  if (mode === "slow") await new Promise((r) => setTimeout(r, 12_000));
  return result.withReceipt(
    Response.json({ city: "Dublin", temp_c: 11, conditions: "light rain", wind_kph: 24, issued_at: new Date().toISOString() }),
  );
}
