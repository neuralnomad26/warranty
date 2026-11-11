import { Pool } from "pg";
import { env } from "./env";

let pool: Pool | null = null;

/** Shared Postgres pool (Supabase transaction pooler, which suits serverless). */
export function db(): Pool {
  if (!pool) {
    const u = new URL(env.dbPoolerUrl());
    pool = new Pool({
      host: u.hostname,
      port: 6543,
      user: decodeURIComponent(u.username),
      password: env.dbPassword(),
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}
