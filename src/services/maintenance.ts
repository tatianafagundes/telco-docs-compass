// Housekeeping that must not run inside a person's request: it touches rows of every tenant, so
// it belongs to the scheduler (the `jobs/bulk-documents` route, every minute).
//
//   - documents past their expiry date become Expired, with an activity event;
//   - saved answers to repeated requests (idempotency keys) older than their lifetime are removed;
//   - system access tokens past their expiry are removed.
//
// Each step is separate: one failing is logged and does not stop the others.
import { IDEMPOTENCY_TTL_HOURS } from "@/services/document-rules";
import { must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";

export interface MaintenanceResult {
  expiredDocuments: number;
  failed: string[];
}

export async function expireDueDocuments(admin: Db, now = new Date()): Promise<number> {
  const rows = must(
    await admin
      .from("documents")
      .update({ status: "expired", updated_at: now.toISOString() })
      .lt("expiry_date", now.toISOString().slice(0, 10))
      .in("status", ["approved", "effective"])
      .is("deleted_at", null)
      .select("id, tenant_id"),
    "expiring documents past their expiry date",
  );
  for (const d of rows ?? []) {
    must(
      await admin.from("document_events").insert({
        tenant_id: d.tenant_id,
        document_id: d.id,
        action: "statusChange",
        detail: "Expired on its expiry date",
      }),
      "recording the expiry of a document",
    );
  }
  return rows?.length ?? 0;
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
  const result: MaintenanceResult = { expiredDocuments: 0, failed: [] };
  const steps: [string, () => Promise<unknown>][] = [
    [
      "expireDocuments",
      async () => (result.expiredDocuments = await expireDueDocuments(admin, now)),
    ],
    ["idempotencyKeys", () => deleteStaleIdempotencyKeys(admin, now)],
    ["accessTokens", () => deleteExpiredTokens(admin, now)],
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
