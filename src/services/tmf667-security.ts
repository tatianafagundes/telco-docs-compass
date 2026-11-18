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

export { isPrivateIp } from "@/services/ip-rules";
/** Callback addresses must be https and not point at internal hosts. */
export function isSafeCallback(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname;
    return !(
      h === "localhost" ||
      h.endsWith(".local") ||
      /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
      h.includes(":")
    );
  } catch {
    return false;
  }
}
