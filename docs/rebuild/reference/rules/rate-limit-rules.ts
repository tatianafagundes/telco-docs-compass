/**
 * Per-system request limits for the TMF API. Each connected system has its own allowance per
 * one-minute window, counted separately for reads (GET) and changes (everything else).
 */

export const DEFAULT_LIMITS = { read: 120, write: 30 } as const;
export const LIMIT_BOUNDS = { read: { min: 1, max: 6000 }, write: { min: 1, max: 1000 } } as const;
export const WINDOW_SECONDS = 60;

export type RateKind = "read" | "write";

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends (1–60). */
  resetSeconds: number;
}

export function rateKind(method: string): RateKind {
  return method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD" ? "read" : "write";
}

/** `hits` is the count for this system and kind in the current window, including this request. */
export function decideRate(hits: number, limit: number, now: Date): RateDecision {
  const resetSeconds = Math.max(1, WINDOW_SECONDS - now.getUTCSeconds());
  return { allowed: hits <= limit, limit, remaining: Math.max(0, limit - hits), resetSeconds };
}

export function isValidLimit(kind: RateKind, n: number): boolean {
  return Number.isInteger(n) && n >= LIMIT_BOUNDS[kind].min && n <= LIMIT_BOUNDS[kind].max;
}

/** Standard rate-limit headers (IETF RateLimit fields plus the widely used X-RateLimit-* names). */
export function rateHeaders(d: RateDecision): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(d.limit),
    "RateLimit-Remaining": String(d.remaining),
    "RateLimit-Reset": String(d.resetSeconds),
    "RateLimit-Policy": `${d.limit};w=${WINDOW_SECONDS}`,
    "X-RateLimit-Limit": String(d.limit),
    "X-RateLimit-Remaining": String(d.remaining),
  };
  if (!d.allowed) h["Retry-After"] = String(d.resetSeconds);
  return h;
}

export function retryGuidance(kind: RateKind, d: RateDecision): string {
  const what = kind === "read" ? "reads" : "changes";
  return `This system has used its allowance of ${d.limit} ${what} per minute. Wait ${d.resetSeconds} seconds (see Retry-After) and send the request again. Other connected systems are not affected. An administrator can raise this system's allowance in Admin > Connected systems.`;
}

export type WindowVerdict = "record" | "summarise" | "drop";
export interface WindowLimiter {
  /** One more event for `key`. `record` while under the limit, `summarise` exactly once when it is crossed, then `drop`. */
  hit(key: string, now?: number): WindowVerdict;
  reset(): void;
}
const LIMITER_MAX_KEYS = 1000;
/**
 * Fixed-window counter kept in memory, one counter per key (here: per person). It costs no
 * database call, which is the point: it protects the database from the very requests it counts.
 * Each server instance counts on its own, so the limit is approximate across instances.
 */
export function createWindowLimiter(limit: number, windowMs: number): WindowLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, now = Date.now()) {
      if (windows.size > LIMITER_MAX_KEYS) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
        // Still full of live keys (a flood of distinct ones): drop the oldest so memory stays bounded.
        for (const k of windows.keys()) {
          if (windows.size <= LIMITER_MAX_KEYS) break;
          windows.delete(k);
        }
      }
      const current = windows.get(key);
      const w = current && now - current.start < windowMs ? current : { start: now, count: 0 };
      w.count++;
      windows.set(key, w);
      if (w.count <= limit) return "record";
      return w.count === limit + 1 ? "summarise" : "drop";
    },
    reset() {
      windows.clear();
    },
  };
}
