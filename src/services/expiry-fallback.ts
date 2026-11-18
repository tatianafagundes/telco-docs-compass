// A safety net for expiry when the scheduler is not running (for example in a preview where it
// was never set up): opening a list expires the caller's own tenant's due documents, at most once
// a minute per tenant on this server instance.
//
// The scheduled job (maintenance.ts) stays the main path. This never fails the read that triggered
// it: an error is logged and the list loads as it is.
import { expireDueDocuments } from "@/services/maintenance";
import type { Db } from "@/services/seam-runtime";

/** How often one tenant's expiry may run from a read, per server instance. */
export const EXPIRY_FALLBACK_INTERVAL_MS = 60_000;
const lastRun = new Map<string, number>();
/** Most tenants remembered; past this the oldest are forgotten (they may then run one extra time). */
export const MAX_TENANTS = 1000;

/** Exported for tests. */
export function resetExpiryFallback(): void {
  lastRun.clear();
}

/**
 * @param admin the privileged client, or a function that loads it; loading happens inside the
 * safety net, so a missing server key cannot fail the read either.
 */
export async function expireOnRead(
  admin: Db | (() => Promise<Db>),
  tenantId: string,
  now = Date.now(),
): Promise<void> {
  const last = lastRun.get(tenantId);
  if (last !== undefined && now - last < EXPIRY_FALLBACK_INTERVAL_MS) return;
  lastRun.delete(tenantId);
  lastRun.set(tenantId, now);
  for (const k of lastRun.keys()) {
    if (lastRun.size <= MAX_TENANTS) break;
    lastRun.delete(k);
  }
  try {
    const db = typeof admin === "function" ? await admin() : admin;
    await expireDueDocuments(db, new Date(now), tenantId);
  } catch (e) {
    console.error(
      JSON.stringify({
        op: "expiry.onRead",
        tenant: tenantId,
        cause: e instanceof Error ? e.name : "unknown",
      }),
    );
  }
}
