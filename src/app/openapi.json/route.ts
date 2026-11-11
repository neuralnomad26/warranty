import { generate } from "mppx/discovery";
import { FLAKY_PRICE, MIN_PREMIUM } from "@/lib/config";
import { env } from "@/lib/env";
import { mpp } from "@/lib/mpp";

export const dynamic = "force-dynamic";

/** Discovery document: tells agents (and the hackathon scanner) which routes are paid and what they cost. */
export async function GET(request: Request) {
  const origin = env.publicOrigin() ?? new URL(request.url).origin;
  const m = mpp();
  const doc = generate(m, {
    info: { title: "Warranty", version: "1.0.0" },
    serviceInfo: {
      categories: ["payments", "reliability", "developer-tools"],
      docs: { homepage: origin, llms: `${origin}/llms.txt`, apiReference: `${origin}/openapi.json` },
    },
    routes: [
      {
        method: "POST",
        path: "/api/call",
        summary: "Covered call to another MPP service. Price = the target's price + a premium; this is the minimum. Refunded automatically if the result fails your contract.",
        handler: m.charge({ amount: MIN_PREMIUM, description: "Warranty covered call (minimum; exact quote in the 402)" }),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: { url: `${origin}/api/flaky?mode=ok`, method: "GET", contract: { status: 200, content_type: "application/json", max_latency_ms: 10000 } },
              schema: {
                type: "object",
                required: ["url"],
                example: { url: `${origin}/api/flaky?mode=ok`, method: "GET", contract: { status: 200, content_type: "application/json", max_latency_ms: 10000 } },
                properties: {
                  url: { type: "string", description: "The MPP endpoint to buy from.", default: `${origin}/api/flaky?mode=ok`, example: `${origin}/api/flaky?mode=ok` },
                  method: { type: "string", enum: ["GET", "POST"], default: "GET" },
                  headers: { type: "object", additionalProperties: { type: "string" } },
                  body: { description: "Request body for POST targets." },
                  contract: {
                    type: "object",
                    properties: {
                      status: { type: "integer", default: 200 },
                      content_type: { type: "string" },
                      json_schema: { type: "object" },
                      min_bytes: { type: "integer" },
                      max_latency_ms: { type: "integer", default: 10000 },
                      max_price: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        method: "GET",
        path: "/api/flaky",
        summary: "Demo weather service that breaks on request (?mode=ok|garbage|slow|error). Use it to see Warranty refund a failed purchase.",
        handler: m.charge({ amount: FLAKY_PRICE, recipient: env.flakyAddress(), description: "Flaky Weather: one forecast" }),
      },
    ],
  });
  return Response.json(doc, { headers: { "Cache-Control": "public, max-age=60" } });
}
