// Event deliveries the sender gave up on (`gave_up_at` set): how many there are, and putting one
// back in the queue by hand once the receiver is fixed.
//
// Does not deliver anything itself: the delivery pass in tmf-events.ts picks a requeued row up.
// Does not decide who may resend: the caller does (tenant admins).
import { must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";

/** How many deliveries were given up on, for the whole system or for one tenant. A count above zero is the alert. */
export async function countDeadLetters(admin: Db, tenantId?: string): Promise<number> {
  let q = admin
    .from("event_deliveries")
    .select("event_id", { count: "exact", head: true })
    .gte("gave_up_at", "1970-01-01T00:00:00Z");
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const res = await q;
  must(res, "counting the deliveries that were given up on");
  return res.count ?? 0;
}

/**
 * Puts one given-up delivery back in the queue, as if new. Only for the tenant's own, and only if
 * it was given up on (a delivery in progress or already delivered is left alone).
 * @returns true when a delivery was requeued.
 */
export async function resendDeadLetter(
  admin: Db,
  tenantId: string,
  ref: { eventId: number; subscriptionId: string },
  now = new Date(),
): Promise<boolean> {
  const rows = must(
    await admin
      .from("event_deliveries")
      .update({
        gave_up_at: null,
        attempts: 0,
        next_attempt_at: now.toISOString(),
        locked_until: null,
        last_error: null,
        last_status: null,
      })
      .eq("tenant_id", tenantId)
      .eq("event_id", ref.eventId)
      .eq("subscription_id", ref.subscriptionId)
      .gte("gave_up_at", "1970-01-01T00:00:00Z")
      .select("event_id"),
    "putting a given-up delivery back in the queue",
  );
  return (rows?.length ?? 0) > 0;
}
