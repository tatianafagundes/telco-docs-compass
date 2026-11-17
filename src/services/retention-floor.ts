// Finds the minimum retention (in days) that the master tenant imposes on a tenant, so every way
// of deleting a document applies the same floor. The rule itself is `deleteBlocker` in
// document-rules.ts; this file only reads the number.
//
// A tenant with no parent, or a parent that sets no floor, has none (null).
import { DatabaseError, must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";

export async function masterRetentionFloor(admin: Db, tenantId: string): Promise<number | null> {
  const tenant = must(
    await admin.from("tenants").select("parent_tenant_id").eq("id", tenantId).maybeSingle(),
    "reading the parent of a tenant",
  );
  if (!tenant?.parent_tenant_id) return null;
  const master = must(
    await admin
      .from("tenants")
      .select("hard_floors")
      .eq("id", tenant.parent_tenant_id)
      .maybeSingle(),
    "reading the retention floor of the master tenant",
  );
  // A parent that points at nothing, or a floor that is not a whole number of days, is bad data:
  // refuse to decide rather than read it as "no floor".
  if (!master) throw new DatabaseError("reading a master tenant that does not exist");
  const days = ((master.hard_floors ?? {}) as { minRetentionDays?: unknown }).minRetentionDays;
  if (days === undefined || days === null) return null;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 0)
    throw new DatabaseError("reading a retention floor that is not a whole number of days");
  return days;
}
