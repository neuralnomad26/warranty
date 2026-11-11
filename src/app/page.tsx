import { headers } from "next/headers";
import Home from "@/components/Home";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function Page() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const origin = env.publicOrigin() ?? `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  return <Home origin={origin} network={env.testnet() ? "Tempo testnet" : "Tempo mainnet"} wallet={env.warrantyAddress()} />;
}
