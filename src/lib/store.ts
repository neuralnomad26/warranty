import { createHash } from "node:crypto";
import { SCORE_WINDOW_DAYS } from "./config";
import { db } from "./db";

let ready: Promise<void> | null = null;

/** Creates tables on first use. Every statement is safe to run again. */
export function ensureSchema(): Promise<void> {
  return (ready ??= db()
    .query(
      `create table if not exists warranty_calls (
         id uuid primary key,
         created_at timestamptz not null default now(),
         source text not null default 'agent',
         payer text,
         target_host text not null,
         url text not null,
         method text not null,
         currency text,
         quoted_units bigint not null,
         premium_units bigint not null,
         total_units bigint not null,
         covered boolean not null,
         paid_target boolean not null default false,
         target_receipt jsonb,
         latency_ms integer,
         checks jsonb not null default '[]'::jsonb,
         verdict text not null,
         failure_reason text,
         refund_units bigint,
         refund_tx text,
         refund_error text,
         certificate jsonb
       );
       create index if not exists warranty_calls_host_idx on warranty_calls (target_host, created_at desc);
       create index if not exists warranty_calls_payer_idx on warranty_calls (payer, created_at desc);
       create table if not exists warranty_quotes (
         key text primary key,
         target_units bigint not null,
         premium_units bigint not null,
         covered boolean not null,
         expires_at timestamptz not null
       );
       create table if not exists warranty_services (
         host text primary key,
         name text not null,
         category text,
         scan_url text,
         scan_contract jsonb,
         callable boolean not null default true,
         trusted boolean not null default false,
         note text
       );
       create table if not exists warranty_demo_hits (
         ip_hash text not null,
         at timestamptz not null default now()
       );
       create index if not exists warranty_demo_hits_idx on warranty_demo_hits (at desc);`,
    )
    .then(() => undefined)
    .catch((e) => {
      ready = null;
      throw e;
    }));
}

export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

export type HostStats = { n: number; passes: number; trusted: boolean };

export async function hostStats(host: string): Promise<HostStats> {
  const { rows } = await db().query(
    `select
       (select count(*) from warranty_calls where target_host = $1 and created_at > now() - ($2 || ' days')::interval)::int as n,
       (select count(*) from warranty_calls where target_host = $1 and verdict = 'pass' and created_at > now() - ($2 || ' days')::interval)::int as passes,
       coalesce((select trusted from warranty_services where host = $1), false) as trusted`,
    [host, String(SCORE_WINDOW_DAYS)],
  );
  return rows[0] as HostStats;
}

export async function refundsToday(payer: string): Promise<number> {
  const { rows } = await db().query(
    `select count(*)::int as n from warranty_calls where lower(payer) = lower($1) and refund_tx is not null and created_at > now() - interval '24 hours'`,
    [payer],
  );
  return rows[0].n as number;
}

export type Quote = { targetUnits: bigint; premiumUnits: bigint; covered: boolean };

export async function getQuote(key: string): Promise<Quote | null> {
  const { rows } = await db().query(
    `select target_units, premium_units, covered from warranty_quotes where key = $1 and expires_at > now()`,
    [key],
  );
  if (!rows[0]) return null;
  return { targetUnits: BigInt(rows[0].target_units), premiumUnits: BigInt(rows[0].premium_units), covered: rows[0].covered };
}

export async function putQuote(key: string, q: Quote, ttlSeconds: number): Promise<void> {
  await db().query(
    `insert into warranty_quotes (key, target_units, premium_units, covered, expires_at)
     values ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)
     on conflict (key) do update set target_units = excluded.target_units, premium_units = excluded.premium_units,
       covered = excluded.covered, expires_at = excluded.expires_at`,
    [key, q.targetUnits.toString(), q.premiumUnits.toString(), q.covered, String(ttlSeconds)],
  );
}

export type CallRow = {
  id: string;
  source: string;
  payer: string | null;
  target_host: string;
  url: string;
  method: string;
  currency: string | null;
  quoted_units: bigint;
  premium_units: bigint;
  total_units: bigint;
  covered: boolean;
  paid_target: boolean;
  target_receipt: unknown;
  latency_ms: number | null;
  checks: unknown;
  verdict: "pass" | "fail";
  failure_reason: string | null;
  refund_units: bigint | null;
  refund_tx: string | null;
  refund_error: string | null;
  certificate: unknown;
};

export async function insertCall(c: CallRow): Promise<void> {
  await db().query(
    `insert into warranty_calls (id, source, payer, target_host, url, method, currency, quoted_units, premium_units, total_units,
       covered, paid_target, target_receipt, latency_ms, checks, verdict, failure_reason, refund_units, refund_tx, refund_error, certificate)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [
      c.id, c.source, c.payer, c.target_host, c.url, c.method, c.currency, c.quoted_units.toString(), c.premium_units.toString(),
      c.total_units.toString(), c.covered, c.paid_target, JSON.stringify(c.target_receipt ?? null), c.latency_ms,
      JSON.stringify(c.checks), c.verdict, c.failure_reason, c.refund_units?.toString() ?? null, c.refund_tx, c.refund_error,
      JSON.stringify(c.certificate ?? null),
    ],
  );
}

const seeded = new Set<string>();

/** This deployment's own demo service is covered from the start, so the demo can show refunds. */
export async function trustSelf(host: string): Promise<void> {
  if (seeded.has(host)) return;
  await db().query(
    `insert into warranty_services (host, name, category, scan_url, trusted, note)
     values ($1, 'Flaky Weather (Warranty demo)', 'Demo', $2, true, 'Demo service that breaks on purpose.')
     on conflict (host) do nothing`,
    [host, `/api/flaky`],
  );
  seeded.add(host);
}

export async function getCall(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db().query(`select * from warranty_calls where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function scores() {
  const { rows } = await db().query(
    `with agg as (
       select target_host as host,
              count(*)::int as n,
              (count(*) filter (where verdict = 'pass'))::int as passes,
              (percentile_cont(0.5) within group (order by latency_ms))::int as median_latency_ms,
              mode() within group (order by failure_reason) as top_failure,
              max(created_at) as last_call
       from warranty_calls
       where created_at > now() - ($1 || ' days')::interval
       group by 1
     )
     select coalesce(a.host, s.host) as host, coalesce(s.name, a.host) as name, s.category, coalesce(s.callable, true) as callable,
            s.note, coalesce(a.n, 0) as n, coalesce(a.passes, 0) as passes, a.median_latency_ms, a.top_failure, a.last_call
     from agg a full outer join warranty_services s on s.host = a.host
     order by coalesce(a.n, 0) desc, 2`,
    [String(SCORE_WINDOW_DAYS)],
  );
  return rows.map((r) => ({ ...r, pass_rate: r.n ? Number((r.passes / r.n).toFixed(3)) : null }));
}

export async function hostHistory(host: string) {
  const { rows } = await db().query(
    `select id, created_at, source, verdict, failure_reason, latency_ms, covered, quoted_units, total_units, refund_units, refund_tx
     from warranty_calls where target_host = $1 order by created_at desc limit 50`,
    [host],
  );
  return rows;
}

export async function totals() {
  const { rows } = await db().query(
    `select count(*)::int as calls,
            (count(*) filter (where verdict = 'pass'))::int as passed,
            (count(*) filter (where verdict = 'fail'))::int as failed,
            (count(*) filter (where refund_tx is not null))::int as refunds,
            coalesce(sum(refund_units) filter (where refund_tx is not null), 0)::text as refunded_units,
            coalesce(sum(total_units), 0)::text as covered_units,
            (count(*) filter (where source = 'demo'))::int as demo_calls,
            (count(*) filter (where source = 'scan'))::int as scan_calls,
            (count(*) filter (where source = 'agent'))::int as agent_calls
     from warranty_calls`,
  );
  const { rows: reasons } = await db().query(
    `select failure_reason as reason, count(*)::int as n from warranty_calls where failure_reason is not null group by 1 order by 2 desc`,
  );
  const { rows: recent } = await db().query(
    `select id, created_at, source, target_host, verdict, failure_reason, total_units, refund_tx from warranty_calls order by created_at desc limit 8`,
  );
  return { ...rows[0], failure_reasons: reasons, recent };
}

/** Returns false when this caller (or everyone together) has used the demo too much in the last minute. */
export async function allowDemo(ipHash: string): Promise<boolean> {
  const { rows } = await db().query(
    `select (count(*) filter (where ip_hash = $1))::int as mine, count(*)::int as everyone
     from warranty_demo_hits where at > now() - interval '1 minute'`,
    [ipHash],
  );
  if (rows[0].mine >= 4 || rows[0].everyone >= 20) return false;
  await db().query(`insert into warranty_demo_hits (ip_hash) values ($1)`, [ipHash]);
  return true;
}
