// Small security helpers for the API: hashes, signatures, bearer parsing, callback addresses.
// Pure: no I/O.

/** Signature covers timestamp and body so a captured event can't be replayed later. */
export function signedPayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+((?:erad_|eradt_)[A-Za-z0-9_-]{20,120})$/.exec(header.trim());
  return m?.[1] ?? null;
}

import { isPrivateIp } from "@/services/ip-rules";
export { isPrivateIp };
/** Names that only ever point inside a network. */
const INTERNAL_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/;

/**
 * The address on its own, before any DNS lookup: https, no credentials in it, not an internal
 * name, and not a private IP address (`isPrivateIp`, the one classification used everywhere).
 * IPv6 literals are refused outright. A name that passes still has its DNS answers checked
 * (`resolvesPublic` in gateway-fetch.ts).
 */
export function isSafeCallback(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  // The URL parser lower-cases the host and turns decimal or hex IPv4 forms into dotted ones.
  const host = u.hostname.replace(/\.+$/, "");
  if (!host || host.includes(":") || host.startsWith("[")) return false;
  if (INTERNAL_NAMES.test(host)) return false;
  if (/^[\d.]+$/.test(host)) return !isPrivateIp(host);
  return true;
}
