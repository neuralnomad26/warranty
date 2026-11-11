// The only place env vars are read.

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const opt = (name: string) => process.env[name]?.trim() || undefined;
const hex = (name: string) => req(name) as `0x${string}`;

export const env = {
  mppSecret: () => req("MPP_SECRET_KEY"),
  /** Realm shown in every 402 challenge: the production hostname. Unset locally, where mppx uses the request host. */
  realm: () => opt("MPP_REALM"),
  testnet: () => (opt("MPP_TESTNET") ?? "true") !== "false",

  /** The pool: receives agents' payments, pays target services, pays refunds. */
  warrantyAddress: () => hex("WARRANTY_ADDRESS"),
  warrantyKey: () => hex("WARRANTY_PRIVATE_KEY"),
  /** Separate wallet for the demo flaky service, so money really moves between parties. */
  flakyAddress: () => hex("FLAKY_ADDRESS"),
  demoAgentKey: () => hex("DEMO_AGENT_PRIVATE_KEY"),
  demoAgentAddress: () => hex("DEMO_AGENT_ADDRESS"),

  dbPoolerUrl: () => req("SUPABASE_POOLER_URL"),
  dbPassword: () => req("SUPABASE_DB_PASS"),

  /** Public origin of this deployment, used when Warranty calls its own demo service. */
  publicOrigin: () => opt("PUBLIC_ORIGIN"),
};
