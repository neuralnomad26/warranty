import Ajv from "ajv";
import { DEFAULT_MAX_LATENCY_MS, HARD_MAX_LATENCY_MS } from "./config";
import { toUnits } from "./money";

export type Contract = {
  status: number;
  content_type?: string;
  json_schema?: Record<string, unknown>;
  min_bytes?: number;
  max_latency_ms: number;
  max_price?: string;
};

export type CallRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  contract: Contract;
};

export const FAILURE_REASONS = [
  "payment_failed",
  "timeout",
  "no_receipt",
  "http_error",
  "wrong_content_type",
  "too_small",
  "schema_mismatch",
  "overcharge",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export type Check = { name: string; ok: boolean; expected: string; actual: string; reason?: FailureReason };

const ajv = new Ajv({ strict: false, allErrors: false });
// Headers an agent may not set on the target request: they belong to the transport or to payment.
const BLOCKED_HEADERS = /^(host|content-length|connection|transfer-encoding|authorization|payment-authorization|cookie|accept-payment)$/i;

export class BadRequest extends Error {}

/** Validates the agent's request body. Throws BadRequest with a message safe to show the caller. */
export function parseCallRequest(input: unknown): CallRequest {
  if (!input || typeof input !== "object") throw new BadRequest("Body must be a JSON object with url and contract.");
  const b = input as Record<string, unknown>;
  if (typeof b.url !== "string" || b.url.length > 2000) throw new BadRequest("url is required (string, max 2000 chars).");
  const method = String(b.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") throw new BadRequest("method must be GET or POST.");

  const headers: Record<string, string> = {};
  if (b.headers !== undefined) {
    if (typeof b.headers !== "object" || b.headers === null) throw new BadRequest("headers must be an object of strings.");
    for (const [k, v] of Object.entries(b.headers)) {
      if (typeof v !== "string" || k.length > 100 || v.length > 2000) throw new BadRequest(`header ${k} is not a short string.`);
      if (!BLOCKED_HEADERS.test(k)) headers[k] = v;
    }
  }

  let body: string | undefined;
  if (b.body !== undefined && b.body !== null) {
    if (method === "GET") throw new BadRequest("body is only allowed with POST.");
    body = typeof b.body === "string" ? b.body : JSON.stringify(b.body);
    if (typeof b.body !== "string" && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
    if (body.length > 100_000) throw new BadRequest("body is larger than 100 KB.");
  }

  const c = (b.contract ?? {}) as Record<string, unknown>;
  if (typeof c !== "object") throw new BadRequest("contract must be an object.");
  const status = c.status === undefined ? 200 : Number(c.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new BadRequest("contract.status must be an HTTP status code.");
  const max_latency_ms = c.max_latency_ms === undefined ? DEFAULT_MAX_LATENCY_MS : Number(c.max_latency_ms);
  if (!Number.isFinite(max_latency_ms) || max_latency_ms < 100 || max_latency_ms > HARD_MAX_LATENCY_MS) {
    throw new BadRequest(`contract.max_latency_ms must be between 100 and ${HARD_MAX_LATENCY_MS}.`);
  }
  const contract: Contract = { status, max_latency_ms };
  if (c.content_type !== undefined) {
    if (typeof c.content_type !== "string" || c.content_type.length > 100) throw new BadRequest("contract.content_type must be a short string.");
    contract.content_type = c.content_type.toLowerCase();
  }
  if (c.min_bytes !== undefined) {
    const n = Number(c.min_bytes);
    if (!Number.isInteger(n) || n < 0) throw new BadRequest("contract.min_bytes must be a non-negative integer.");
    contract.min_bytes = n;
  }
  if (c.max_price !== undefined) {
    try {
      toUnits(String(c.max_price));
    } catch {
      throw new BadRequest('contract.max_price must be a decimal string such as "0.05".');
    }
    contract.max_price = String(c.max_price);
  }
  if (c.json_schema !== undefined) {
    if (typeof c.json_schema !== "object" || c.json_schema === null) throw new BadRequest("contract.json_schema must be a JSON Schema object.");
    if (JSON.stringify(c.json_schema).length > 20_000) throw new BadRequest("contract.json_schema is larger than 20 KB.");
    try {
      ajv.compile(c.json_schema as object);
    } catch (e) {
      throw new BadRequest(`contract.json_schema is not a valid JSON Schema: ${e instanceof Error ? e.message : "invalid"}`);
    }
    contract.json_schema = c.json_schema as Record<string, unknown>;
  }
  return { url: b.url, method, headers, body, contract };
}

export type Outcome = {
  /** Set when the call never produced a response. */
  transport?: "timeout" | "payment_failed";
  status?: number;
  contentType?: string;
  bytes?: Uint8Array;
  latencyMs: number;
  receipt?: { status?: string; reference?: string; method?: string } | null;
  quotedUnits: bigint;
  chargedUnits: bigint;
};

/** Runs every check the contract asks for, in a fixed order. The first failure names the reason. */
export function runChecks(contract: Contract, o: Outcome): { checks: Check[]; reason: FailureReason | null } {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, expected: string, actual: string, reason: FailureReason) =>
    checks.push({ name, ok, expected, actual, ...(ok ? {} : { reason }) });

  if (o.transport) {
    add("responded", false, `a response within ${contract.max_latency_ms} ms`, o.transport === "timeout" ? "no response in time" : "payment to the service failed", o.transport);
    return { checks, reason: o.transport };
  }
  add("latency", o.latencyMs <= contract.max_latency_ms, `<= ${contract.max_latency_ms} ms`, `${o.latencyMs} ms`, "timeout");
  add("receipt", o.receipt?.status === "success", "a valid payment receipt", o.receipt ? `receipt status ${o.receipt.status}` : "no receipt", "no_receipt");
  add("status", o.status === contract.status, String(contract.status), String(o.status), "http_error");
  if (contract.content_type) {
    const actual = (o.contentType ?? "").toLowerCase();
    add("content_type", actual.startsWith(contract.content_type), contract.content_type, actual || "none", "wrong_content_type");
  }
  if (contract.min_bytes !== undefined) {
    add("min_bytes", (o.bytes?.length ?? 0) >= contract.min_bytes, `>= ${contract.min_bytes} bytes`, `${o.bytes?.length ?? 0} bytes`, "too_small");
  }
  if (contract.json_schema) {
    let ok = false;
    let actual = "body is not JSON";
    try {
      const data = JSON.parse(new TextDecoder().decode(o.bytes ?? new Uint8Array()));
      const validate = ajv.compile(contract.json_schema);
      ok = validate(data) as boolean;
      actual = ok ? "matches" : ajv.errorsText(validate.errors).slice(0, 200);
    } catch {}
    add("json_schema", ok, "body matches the schema", actual, "schema_mismatch");
  }
  add("price", o.chargedUnits <= o.quotedUnits, `<= quoted (${o.quotedUnits} units)`, `${o.chargedUnits} units`, "overcharge");

  const order: FailureReason[] = ["timeout", "no_receipt", "http_error", "wrong_content_type", "too_small", "schema_mismatch", "overcharge"];
  const failed = checks.filter((c) => !c.ok).map((c) => c.reason!);
  const reason = order.find((r) => failed.includes(r)) ?? null;
  return { checks, reason };
}
