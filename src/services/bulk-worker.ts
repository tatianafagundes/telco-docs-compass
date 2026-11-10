// Processes queued bulk jobs in batches. Each document is re-checked with the same rules as
// single actions and audited with the requesting person as the actor. Server-only (needs admin client).
import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import { pendingRequiredDetails, type AppRole, type SpecCharacteristic } from "@/services/document-rules";
import type { Db } from "@/services/seam-runtime";
import { BULK_BATCH, bulkSkipReason, type BulkAction, type BulkParams, type SkipReason } from "@/services/search-rules";

interface JobRow {
  id: string;
  tenant_id: string;
  created_by: string;
  actor_role: AppRole;
  action: BulkAction;
  params: { to?: DocStatus; sensitivity?: string; reason?: string };
  doc_ids: string[];
  total: number;
  done: number;
  changed: number;
  skipped: Record<string, number>;
}

async function runBatch(admin: Db, job: JobRow) {
  const ids = job.doc_ids.slice(job.done, job.done + BULK_BATCH);
  const { data: docs } = await admin
    .from("documents")
    .select("id, status, legal_hold, sensitivity, document_type, current_version_id")
    .in("id", ids)
    .eq("tenant_id", job.tenant_id)
    .is("deleted_at", null);
  const byId = new Map((docs ?? []).map((d) => [d.id, d]));

  let specs: { code: string; definition: unknown }[] = [];
  let pendingByDoc = new Map<string, { name: string; status: "pending" | "accepted" | "edited" | "rejected" }[]>();
  if (job.action === "transition" && job.params.to === "approved") {
    specs = ((await admin.rpc("effective_specifications", { p_tenant: job.tenant_id })).data ?? []) as typeof specs;
    const { data: fields } = await admin.from("extraction_fields").select("document_id, version_id, name, status").in("document_id", ids);
    pendingByDoc = new Map();
    for (const f of fields ?? []) {
      const d = byId.get(f.document_id);
      if (!d || f.version_id !== d.current_version_id) continue;
      pendingByDoc.set(f.document_id, [...(pendingByDoc.get(f.document_id) ?? []), { name: f.name, status: f.status }]);
    }
  }

  const skipped: Record<string, number> = { ...job.skipped };
  let changed = job.changed;
  const now = new Date().toISOString();
  const params: BulkParams = { ...(job.params.to ? { to: job.params.to } : {}), ...(job.params.sensitivity ? { sensitivity: job.params.sensitivity } : {}) };
  for (const id of ids) {
    const d = byId.get(id);
    let pendingRequired = 0;
    if (d && specs.length) {
      const def = specs.find((s) => s.code === d.document_type)?.definition as { specCharacteristic?: SpecCharacteristic[] } | undefined;
      pendingRequired = pendingRequiredDetails(def?.specCharacteristic ?? [], pendingByDoc.get(id) ?? []).length;
    }
    const reason: SkipReason | null = bulkSkipReason(
      job.actor_role,
      job.action,
      params,
      d ? { status: d.status, legalHold: d.legal_hold, sensitivity: d.sensitivity, pendingRequired } : null,
    );
    if (reason || !d) {
      const key = reason ?? "notFound";
      skipped[key] = (skipped[key] ?? 0) + 1;
      continue;
    }
    let detail = "";
    if (job.action === "placeHold" || job.action === "releaseHold") {
      const on = job.action === "placeHold";
      await admin
        .from("documents")
        .update({ legal_hold: on, hold_reason: on ? (job.params.reason ?? null) : null, hold_since: on ? now : null, hold_set_by: on ? job.created_by : null, updated_at: now })
        .eq("id", id);
      detail = on ? `Hold placed: ${job.params.reason ?? ""}` : `Hold released: ${job.params.reason ?? ""}`;
    } else if (job.action === "setSensitivity") {
      await admin.from("documents").update({ sensitivity: job.params.sensitivity as "public" | "internal" | "confidential" | "restricted", updated_at: now }).eq("id", id);
      detail = `Sensitivity ${d.sensitivity} to ${job.params.sensitivity ?? ""}`;
    } else {
      await admin.from("documents").update({ status: job.params.to as DocStatus, updated_at: now }).eq("id", id);
      detail = `${d.status} to ${job.params.to ?? ""}`;
    }
    await admin.from("document_events").insert({
      tenant_id: job.tenant_id,
      document_id: id,
      actor: job.created_by,
      action: job.action === "transition" ? "statusChange" : job.action === "setSensitivity" ? "metadataChange" : "hold",
      detail: `${detail} · bulk change`.slice(0, 160),
    });
    changed++;
  }
  const done = job.done + ids.length;
  await admin
    .from("bulk_jobs")
    .update({ done, changed, skipped: skipped as Json, status: done >= job.total ? "done" : "running", ...(done >= job.total ? { finished_at: now } : {}) })
    .eq("id", job.id);
}

/** Runs one batch for each pending job (or just the given one). Safe to call repeatedly. */
export async function processBulkJobs(admin: Db, onlyId?: string): Promise<number> {
  let q = admin.from("bulk_jobs").select("id, tenant_id, created_by, actor_role, action, params, doc_ids, total, done, changed, skipped").in("status", ["queued", "running"]).order("created_at").limit(5);
  if (onlyId) q = q.eq("id", onlyId);
  const { data: jobs } = await q;
  for (const job of (jobs ?? []) as unknown as JobRow[]) {
    try {
      await runBatch(admin, job);
    } catch {
      await admin.from("bulk_jobs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", job.id);
    }
  }
  return jobs?.length ?? 0;
}
