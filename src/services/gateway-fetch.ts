// Outbound requests the gateway makes for a caller: checking that a callback or attachment address
// points to the public internet, and fetching an attachment from it.
//
// Does not authenticate, answer callers or store anything. The classification of single addresses
// is in `ip-rules.ts`; the lookup types and timeout are in `event-delivery-rules.ts`.
import { DNS_LOOKUP_TIMEOUT_MS, DNS_RECORD_TYPES } from "@/services/event-delivery-rules";
import { readResponseBytes } from "@/services/gateway-body";
import { isPrivateIp, isSafeCallback } from "@/services/tmf667-mapper";

/** Largest file the gateway fetches for a caller. */
export const MAX_URL_FETCH_BYTES = 25 * 1024 * 1024;
/** Longest the gateway waits for a file at an address before giving up. */
export const URL_FETCH_TIMEOUT_MS = 15_000;

/** Resolves the host over DNS-over-HTTPS and refuses names that point at private addresses. */
export async function resolvesPublic(url: string): Promise<boolean> {
  if (!isSafeCallback(url)) return false;
  const host = new URL(url).hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !isPrivateIp(host);
  try {
    const answers: string[] = [];
    for (const type of DNS_RECORD_TYPES) {
      const r = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        {
          headers: { accept: "application/dns-json" },
          signal: AbortSignal.timeout(DNS_LOOKUP_TIMEOUT_MS),
        },
      );
      const j = (await r.json()) as { Answer?: { type: number; data: string }[] };
      for (const a of j.Answer ?? []) if (a.type === 1 || a.type === 28) answers.push(a.data);
    }
    return answers.length > 0 && answers.every((ip) => !isPrivateIp(ip));
  } catch {
    return false;
  }
}

export async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!(await resolvesPublic(url))) return null;
  try {
    const r = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const { value, tooLarge } = await readResponseBytes(r, MAX_URL_FETCH_BYTES);
    return tooLarge ? null : value;
  } catch {
    return null;
  }
}
