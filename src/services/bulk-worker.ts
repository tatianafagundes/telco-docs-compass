import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import {
  pendingRequiredDetails,
  type AppRole,
  type SpecCharacteristic,
} from "@/services/document-rules";
import { isOwnDocument } from "@/services/review-flow-rules";
import type { Db } from "@/services/seam-runtime";
import { rolesForDocuments } from "@/services/share-access";
import { holdColumns } from "@/services/document-update";
import { must } from "@/services/shared/must";
import {
  BULK_BATCH,
  bulkSkipReason,
  leaseExpired,
  type BulkParams,
  type SkipReason,
} from "@/services/search-rules";
import {
  JobRow,
  claimJob,
  currentRole,
  failJob,
  settleJob,
  sum,
  withoutLease,
} from "@/services/bulk-job-state";
// Processes queued bulk jobs in batches. Each document is re-checked with the same rules as
// single actions and audited with the requesting person as the actor. Server-only (needs admin client).

/** One batch of one job. An error before the claim leaves the job untouched; after it, the job fails. */
async function runBatch(admin: Db, job: JobRow) {
  if (job.done >= job.total) return settleJob(admin, job);
  const ids = job.doc_ids.slice(job.done, job.done + BULK_BATCH);
  if (ids.length === 0) return failJob(admin, job, "queued", "corruptedJob"); // doc_ids shorter than total
  const role = await currentRole(admin, job);
  if (!role) return failJob(admin, job, "queued", "creatorLostRole");
  if (!(await claimJob(admin, job))) return;
  try {
    await applyBatch(admin, job, ids, role);
  } catch (e) {
    await failJob(admin, job, "running", "batchError", e);
  }
}

async function applyBatch(admin: Db, job: JobRow, ids: string[], role: AppRole) {
  const docs = must(
    await admin
      .from("documents")
      .select(
        "id, status, legal_hold, sensitivity, document_type, current_version_id, created_by, pipeline_state",
      )
      .in("id", ids)
      .eq("tenant_id", job.tenant_id)
      .is("deleted_at", null),
    "reading the documents of a bulk batch",
  );
  const byId = new Map((docs ?? []).map((d) => [d.id, d]));
  // A document the creator reaches only through a share follows that share's level.
  const roleFor = await rolesForDocuments(admin, job.created_by, role, [...byId.keys()]);

  let specs: { code: string; definition: unknown }[] = [];
  let pendingByDoc = new Map<
    string,
    { name: string; status: "pending" | "accepted" | "edited" | "rejected" }[]
  >();
  if (job.action === "transition" && job.params.to === "approved") {
    specs = (must(
      await admin.rpc("effective_specifications", { p_tenant: job.tenant_id }),
      "reading the document types of a bulk batch",
    ) ?? []) as typeof specs;
    const fields = must(
      await admin
        .from("extraction_fields")
        .select("document_id, version_id, name, status")
        .in("document_id", ids),
      "reading the detail checks of a bulk batch",
    );
    pendingByDoc = new Map();
    for (const f of fields ?? []) {
      const d = byId.get(f.document_id);
      if (!d || f.version_id !== d.current_version_id) continue;
      pendingByDoc.set(f.document_id, [
        ...(pendingByDoc.get(f.document_id) ?? []),
        { name: f.name, status: f.status },
      ]);
    }
  }

  const skipped: Record<string, number> = { ...job.skipped };
  let changed = job.changed;
  const changedIds: string[] = [];
  const now = new Date().toISOString();
  const params: BulkParams = {
    ...(job.params.to ? { to: job.params.to } : {}),
    ...(job.params.sensitivity ? { sensitivity: job.params.sensitivity } : {}),
  };
  for (const id of ids) {
    // No access left for the person who started the job (share removed, or never there): skip it.
    const docRole = role === "master_admin" ? null : (roleFor.get(id) ?? null);
    const d = docRole ? byId.get(id) : undefined;
    let pendingRequired = 0;
    if (d && specs.length) {
      const def = specs.find((s) => s.code === d.document_type)?.definition as
        { specCharacteristic?: SpecCharacteristic[] } | undefined;
      pendingRequired = pendingRequiredDetails(
        def?.specCharacteristic ?? [],
        pendingByDoc.get(id) ?? [],
      ).length;
    }
    const reason: SkipReason | null = bulkSkipReason(
      docRole ?? "viewer",
      job.action,
      params,
      d
        ? {
            status: d.status,
            legalHold: d.legal_hold,
            sensitivity: d.sensitivity,
            pendingRequired,
            pipelineState: d.pipeline_state,
            isOwn: isOwnDocument(d.created_by, job.created_by),
          }
        : null,
    );
    if (reason || !d) {
      const key = reason ?? "notFound";
      skipped[key] = (skipped[key] ?? 0) + 1;
      continue;
    }
    let detail = "";
    if (job.action === "placeHold" || job.action === "releaseHold") {
      const on = job.action === "placeHold";
      must(
        await admin
          .from("documents")
          // Same columns as every other way of placing or releasing a hold. A bulk change has no
          // reference, so placing clears an old one and releasing clears it too.
          .update(holdColumns({ active: on, reason: job.params.reason }, job.created_by, now))
          .eq("id", id)
          .eq("tenant_id", job.tenant_id),
        "saving a legal hold in a bulk batch",
      );
      detail = on
        ? `Hold placed: ${job.params.reason ?? ""}`
        : `Hold released: ${job.params.reason ?? ""}`;
    } else if (job.action === "setSensitivity") {
      must(
        await admin
          .from("documents")
          .update({
            sensitivity: job.params.sensitivity as
              "public" | "internal" | "confidential" | "restricted",
            updated_at: now,
          })
          .eq("id", id)
          .eq("tenant_id", job.tenant_id),
        "saving a sensitivity change in a bulk batch",
      );
      detail = `Sensitivity ${d.sensitivity} to ${job.params.sensitivity ?? ""}`;
    } else {
      must(
        await admin
          .from("documents")
          .update({ status: job.params.to as DocStatus, updated_at: now })
          .eq("id", id)
          .eq("tenant_id", job.tenant_id),
        "saving a status change in a bulk batch",
      );
      detail = `${d.status} to ${job.params.to ?? ""}`;
    }
    // The audit row is part of the change: a change without it must not be counted.
    must(
      await admin.from("document_events").insert({
        tenant_id: job.tenant_id,
        document_id: id,
        actor: job.created_by,
        action:
          job.action === "transition"
            ? "statusChange"
            : job.action === "setSensitivity"
              ? "metadataChange"
              : "hold",
        detail: `${detail} · bulk change`.slice(0, 160),
      }),
      "recording the audit event of a bulk change",
    );
    changed++;
    changedIds.push(id);
  }
  // One TMF667 DocumentBatchEvent per pass, for subscriptions that ask for batch events.
  await recordBatchEvent(admin, job.tenant_id, changedIds, job.action);
  const done = job.done + ids.length;
  const accounted = changed + sum(skipped) === done;
  const status = !accounted ? "failed" : done >= job.total ? "done" : "queued";
  // Only while we still hold the job: if it was failed meanwhile, this matches no row and changes nothing.
  const { error } = await admin
    .from("bulk_jobs")
    .update({
      done,
      changed,
      skipped: skipped as Json,
      status,
      params: withoutLease(job.params),
      ...(status === "queued" ? {} : { finished_at: now }),
    })
    .eq("id", job.id)
    .eq("status", "running");
  if (error) throw new Error("could not save the result of a bulk batch");
}

/** Writes one DocumentBatchEvent outbox row for documents changed in one bulk pass (none when empty). */
export async function recordBatchEvent(
  admin: Db,
  tenantId: string,
  documentIds: string[],
  action: string,
): Promise<void> {
  if (documentIds.length === 0) return;
  must(
    await admin.from("event_outbox").insert({
      tenant_id: tenantId,
      event_type: "DocumentBatchEvent",
      document_id: documentIds[0] as string,
      payload: { documentIds, action } as unknown as Json,
    }),
    "recording the batch event of a bulk change",
  );
}

const JOB_COLUMNS =
  "id, tenant_id, created_by, actor_role, action, params, doc_ids, total, done, changed, skipped, status";
/** Jobs a pass looks at per state. Waiting and held jobs are read separately so held ones never crowd out waiting ones. */
export const JOBS_PER_PASS = 5;
export const HELD_JOBS_CHECKED = 20;

/** Runs one batch for each waiting job (or just the given one). Safe to call repeatedly and concurrently. */
export async function processBulkJobs(admin: Db, onlyId?: string): Promise<number> {
  const pick = (status: "queued" | "running", limit: number) => {
    const q = admin
      .from("bulk_jobs")
      .select(JOB_COLUMNS)
      .eq("status", status)
      .order("created_at")
      .limit(limit);
    return onlyId ? q.eq("id", onlyId) : q;
  };
  const [waiting, held] = (
    await Promise.all([pick("queued", JOBS_PER_PASS), pick("running", HELD_JOBS_CHECKED)])
  ).map((r) => must(r, "listing the bulk jobs to process"));
  // A holder that stopped mid-batch is detected by its lease; the job is failed, never finished short.
  for (const job of (held ?? []) as unknown as JobRow[]) {
    if (leaseExpired(job.params.leaseStartedAt, new Date())) {
      await failJob(admin, job, "running", "leaseExpired").catch(() => {});
    }
  }
  for (const job of (waiting ?? []) as unknown as JobRow[]) {
    try {
      await runBatch(admin, job);
    } catch {
      // Nothing is held yet (errors after the claim are handled in runBatch): leave the job as it
      // is and let the next pass try again. A transient error must not kill a healthy job.
    }
  }
  return waiting?.length ?? 0;
}
