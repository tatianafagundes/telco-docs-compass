/**
 * Change-notification delivery rules (pure, tested). Each subscriber has its own delivery record
 * per event, so a failing subscriber is retried on its own and never causes duplicates elsewhere.
 */
import { hmacHex, SIGNATURE_TOLERANCE_SECONDS, signedPayload } from "@/services/tmf667-mapper";

/** First try plus five retries. */
export const MAX_ATTEMPTS = 6;
/** Wait after the 1st, 2nd, … failed attempt. */
export const BACKOFF_SECONDS = [30, 120, 600, 1800, 7200] as const;
/** Deliveries claimed per pass. */
export const DELIVERY_BATCH = 20;
/** Time limit for one POST to a subscriber. */
export const DELIVERY_TIMEOUT_MS = 5_000;
/** The DNS check of a callback host (resolvesPublic in tmf-gateway.ts) looks up these record types, one after the other. */
export const DNS_RECORD_TYPES = ["A", "AAAA"] as const;
export const DNS_LOOKUP_TIMEOUT_MS = 3_000;
/** Slowest possible DNS check of one callback host; done once per host in a pass. */
export const DNS_CHECK_WORST_CASE_MS = DNS_RECORD_TYPES.length * DNS_LOOKUP_TIMEOUT_MS;
/** Seconds a pass can take if every delivery is slow. */
export function worstCasePassSeconds(batch: number = DELIVERY_BATCH): number {
  return Math.ceil((batch * (DELIVERY_TIMEOUT_MS + DNS_CHECK_WORST_CASE_MS)) / 1000);
}
/**
 * How long claimed rows stay locked. It must outlast the slowest pass: if the lock expired while
 * a pass was still sending, the next pass would claim the same rows and the subscriber would get
 * the same event twice. Checked by a test (worstCasePassSeconds <= this).
 */
export const DELIVERY_LOCK_SECONDS = 300;
/** A subscriber's Retry-After is honoured up to one hour. */
export const MAX_RETRY_AFTER_SECONDS = 3600;

export function isDelivered(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Seconds from a Retry-After header (delta-seconds or HTTP date); null when absent or invalid. */
export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - now.getTime()) / 1000));
}

export type Outcome =
  { kind: "delivered" } | { kind: "retry"; waitSeconds: number } | { kind: "gaveUp" };

/** `attempts` counts the attempt just made. */
export function outcomeAfter(
  attempts: number,
  status: number | null,
  retryAfterSeconds: number | null,
): Outcome {
  if (status !== null && isDelivered(status)) return { kind: "delivered" };
  if (attempts >= MAX_ATTEMPTS) return { kind: "gaveUp" };
  const base: number = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1] ?? 7200;
  const asked =
    retryAfterSeconds === null ? 0 : Math.min(retryAfterSeconds, MAX_RETRY_AFTER_SECONDS);
  return { kind: "retry", waitSeconds: Math.max(base, asked) };
}

/** Subscribers only receive events that happened after they subscribed. */
export function subscribedBefore(subscriptionCreatedAt: string, eventCreatedAt: string): boolean {
  return Date.parse(subscriptionCreatedAt) <= Date.parse(eventCreatedAt);
}

/**
 * Reference check for receivers: X-Signature must equal sha256=HMAC(secret, "<timestamp>.<body>")
 * and the timestamp must be within five minutes, so a captured event cannot be replayed later.
 */
export async function verifyEventSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  now: Date,
): Promise<boolean> {
  if (!/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS)
    return false;
  const expected = `sha256=${await hmacHex(secret, signedPayload(timestamp, body))}`;
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
