import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivate(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/**
 * Warranty fetches URLs chosen by strangers, so refuse anything that could
 * reach a private network. `selfOrigin` (this deployment) is always allowed so
 * the demo service works in local development too.
 */
export async function assertPublicUrl(raw: string, selfOrigin: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("url is not a valid URL");
  }
  if (url.origin === selfOrigin) return url;
  if (url.protocol !== "https:") throw new Error("url must use https");
  if (url.username || url.password) throw new Error("url must not contain credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/(^|\.)(localhost|local|internal|lan)$/i.test(host)) throw new Error("url host is not public");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addrs.length === 0) throw new Error("url host does not resolve");
  if (addrs.some(isPrivate)) throw new Error("url host is not public");
  return url;
}
