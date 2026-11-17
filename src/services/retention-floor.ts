// Finds the minimum retention (in days) that the master tenant imposes on a tenant, so every way
// of deleting a document applies the same floor. The rule itself is `deleteBlocker` in
// document-rules.ts; this file only reads the number.
//
// A tenant with no parent, or a parent that sets no floor, has none (null).
import { deleteBlocker } from "@/services/document-rules";
import { tmfError } from "@/services/tmf667-mapper";
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
  const floors = (master?.hard_floors ?? {}) as { minRetentionDays?: number };
  return floors.minRetentionDays ?? null;
}

/**
 * The answer a connected system gets when a document cannot be deleted yet, or null when it can.
 * Same rule as the screens (`deleteBlocker`), including the master floor.
 */
export async function gatewayDeleteRefusal(
  admin: Db,
  tenantId: string,
  doc: {
    legal_hold: boolean;
    retain_until?: string | null;
    created_at: string;
  },
): Promise<{ status: number; body: unknown } | null> {
  try {
    const blocker = deleteBlocker({
      legalHold: doc.legal_hold,
      holdReason: null,
      retainUntil: doc.retain_until ?? null,
      createdAt: doc.created_at,
      minRetentionDays: await masterRetentionFloor(admin, tenantId),
      today: new Date().toISOString().slice(0, 10),
    });
    if (!blocker) return null;
    const held = blocker.code === "doc.delete.legalHold";
    return {
      status: 409,
      body: tmfError(
        409,
        held ? "legalHold" : "retention",
        "Conflict",
        held
          ? "A legal hold keeps this document safe. Release the hold first."
          : `This document must be kept until ${blocker.customerFacing?.detail}.`,
      ),
    };
  } catch (e) {
    if (!(e instanceof DatabaseError)) throw e;
    return {
      status: 503,
      body: tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."),
    };
  }
}
