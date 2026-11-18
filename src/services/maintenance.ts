// Housekeeping that must not run inside a person's request: it touches rows of every tenant, so
// it belongs to the scheduler (the `jobs/bulk-documents` route, every minute).
//
//   - documents past their expiry date become Expired, with an activity event;
//   - saved answers to repeated requests (idempotency keys) older than their lifetime are removed;
//   - system access tokens past their expiry are removed.
//
// Each step is separate: one failing is logged and does not stop the others.
import { IDEMPOTENCY_TTL_HOURS } from "@/services/document-rules";
import { countDeadLetters } from "@/services/delivery-dead-letter";
import { must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";

export interface MaintenanceResult {
  expiredDocuments: number;
  /** Deliveries the sender gave up on. Above zero means a receiver needs attention. */
  deadLetters: number;
  failed: string[];
}

/** Most documents expired in one run; the rest wait for the next minute. */
export const EXPIRE_BATCH = 500;

/** @param tenantId only this tenant's documents; every tenant when omitted (the scheduled job). */
export async function expireDueDocuments(
  admin: Db,
  now = new Date(),
  tenantId?: string,
): Promise<number> {
  let find = admin.from("documents").select("id");
  if (tenantId) find = find.eq("tenant_id", tenantId);
  const due = must(
    await find
      .lt("expiry_date", now.toISOString().slice(0, 10))
      .in("status", ["approved", "effective"])
      .is("deleted_at", null)
      .order("expiry_date")
      .limit(EXPIRE_BATCH),
    "finding documents past their expiry date",
  );
  if (!due?.length) return 0;
  // Expire and record in this order, then check the record was written: the update cannot be
  // undone by a second run (those rows no longer match), so a failed record is reported loudly.
  const expired = must(
    await admin
      .from("documents")
      .update({ status: "expired", updated_at: now.toISOString() })
      .in(
        "id",
        due.map((d) => d.id),
      )
      .in("status", ["approved", "effective"])
      .select("id, tenant_id"),
    "expiring documents past their expiry date",
  );
  if (!expired?.length) return 0;
  try {
    must(
      await admin.from("document_events").insert(
        expired.map((d) => ({
          tenant_id: d.tenant_id,
          document_id: d.id,
          action: "statusChange",
          detail: "Expired on its expiry date",
        })),
      ),
      "recording the expiry of documents",
    );
  } catch (e) {
    console.error(
      JSON.stringify({ op: "maintenance", step: "expiryEvents", missingEvents: expired.length }),
    );
    throw e;
  }
  return expired.length;
}

export async function deleteStaleIdempotencyKeys(admin: Db, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_TTL_HOURS * 3600_000).toISOString();
  must(
    await admin.from("idempotency_keys").delete().lt("created_at", cutoff),
    "removing old idempotency keys",
  );
}

export async function deleteExpiredTokens(admin: Db, now = new Date()): Promise<void> {
  must(
    await admin.from("integration_tokens").delete().lt("expires_at", now.toISOString()),
    "removing expired access tokens",
  );
}

export async function runMaintenance(admin: Db, now = new Date()): Promise<MaintenanceResult> {
  const result: MaintenanceResult = { expiredDocuments: 0, deadLetters: 0, failed: [] };
  const steps: [string, () => Promise<unknown>][] = [
    [
      "expireDocuments",
      async () => (result.expiredDocuments = await expireDueDocuments(admin, now)),
    ],
    ["idempotencyKeys", () => deleteStaleIdempotencyKeys(admin, now)],
    ["accessTokens", () => deleteExpiredTokens(admin, now)],
    ["deadLetters", async () => (result.deadLetters = await countDeadLetters(admin))],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (e) {
      result.failed.push(name);
      console.error(
        JSON.stringify({
          op: "maintenance",
          step: name,
          cause: e instanceof Error ? e.name : "unknown",
        }),
      );
    }
  }
  return result;
}
