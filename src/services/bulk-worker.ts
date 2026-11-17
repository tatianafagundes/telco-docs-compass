// Processes queued bulk jobs in batches. Each document is re-checked with the same rules as
// single actions and audited with the requesting person as the actor. Server-only (needs admin client).
import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import {
  pendingRequiredDetails,
  type AppRole,
  type SpecCharacteristic,
} from "@/services/document-rules";
import { isOwnDocument } from "@/services/review-flow-rules";
import type { Db } from "@/services/seam-runtime";
import { must } from "@/services/shared/must";
import {
  BULK_BATCH,
  bulkSkipReason,
  leaseExpired,
  type BulkAction,
  type BulkParams,
  type SkipReason,
} from "@/services/search-rules";

interface JobRow {
  id: string;
  tenant_id: string;
  created_by: string;
  actor_role: AppRole;
  action: BulkAction;
  params: { to?: DocStatus; sensitivity?: string; reason?: string; leaseStartedAt?: string };
  doc_ids: string[];
  total: number;
  done: number;
  changed: number;
  skipped: Record<string, number>;
  status: "queued" | "running";
}

// How a job moves (status is the lease; no schema change is needed, the CHECK allows these four):
//   queued --claim--> running --batch finished--> queued (more to do) | done | failed
// Only one processor holds a job at a time, so counters are never overwritten by another
// processor and `done` never goes backwards. A holder that stops mid-batch is detected by its
// lease timestamp and the job is marked failed, never finished with short counts.
// Jobs left 'running' by the previous version have no lease and are failed the same way.

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const withoutLease = (p: JobRow["params"]) => {
  const { leaseStartedAt: _lease, ...rest } = p;
  return rest as Json;
};

/**
 * Marks the job failed, but only if it is still in the state this processor saw (`from`, same
 * `done`). A late or mistaken call can therefore never kill a job another processor is running.
 */
async function failJob(admin: Db, job: JobRow, from: "queued" | "running") {
  await admin
    .from("bulk_jobs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      params: withoutLease(job.params),
    })
    .eq("id", job.id)
    .eq("status", from)
    .eq("done", job.done);
}

/** The person who started the job must still hold a role in the tenant when the batch runs. */
async function currentRole(admin: Db, job: JobRow): Promise<AppRole | null> {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", job.created_by)
    .eq("tenant_id", job.tenant_id)
    .maybeSingle();
  if (error) throw new Error("could not read the role of the person who started the job");
  return data?.role ?? null;
}

/**
 * Takes the job for this processor. Succeeds only if nobody else moved it since it was read
 * (compare-and-swap on status and done), so two processors can never apply the same batch.
 */
async function claimJob(admin: Db, job: JobRow): Promise<boolean> {
  const { data, error } = await admin
    .from("bulk_jobs")
    .update({
      status: "running",
      params: { ...job.params, leaseStartedAt: new Date().toISOString() } as Json,
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .eq("done", job.done)
    .select("id");
  if (error) throw new Error("could not claim bulk job");
  return (data?.length ?? 0) > 0;
}

/** A job with nothing left to run is done only if every document was accounted for. */
async function settleJob(admin: Db, job: JobRow) {
  if (job.changed + sum(job.skipped) !== job.total) return failJob(admin, job, "queued");
  await admin
    .from("bulk_jobs")
    .update({ status: "done", finished_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued");
}

/** One batch of one job. An error before the claim leaves the job untouched; after it, the job fails. */
async function runBatch(admin: Db, job: JobRow) {
  if (job.done >= job.total) return settleJob(admin, job);
  const ids = job.doc_ids.slice(job.done, job.done + BULK_BATCH);
  if (ids.length === 0) return failJob(admin, job, "queued"); // doc_ids shorter than total: corrupted
  const role = await currentRole(admin, job);
  if (!role) return failJob(admin, job, "queued");
  if (!(await claimJob(admin, job))) return;
  try {
    await applyBatch(admin, job, ids, role);
  } catch {
    await failJob(admin, job, "running");
  }
}

async function applyBatch(admin: Db, job: JobRow, ids: string[], role: AppRole) {
  const docs = must(
    await admin
      .from("documents")
      .select("id, status, legal_hold, sensitivity, document_type, current_version_id, created_by")
      .in("id", ids)
      .eq("tenant_id", job.tenant_id)
      .is("deleted_at", null),
    "reading the documents of a bulk batch",
  );
  const byId = new Map((docs ?? []).map((d) => [d.id, d]));

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
    const d = byId.get(id);
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
      role,
      job.action,
      params,
      d
        ? {
            status: d.status,
            legalHold: d.legal_hold,
            sensitivity: d.sensitivity,
            pendingRequired,
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
          .update({
            legal_hold: on,
            hold_reason: on ? (job.params.reason ?? null) : null,
            hold_since: on ? now : null,
            hold_set_by: on ? job.created_by : null,
            updated_at: now,
          })
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
const JOBS_PER_PASS = 5;
const HELD_JOBS_CHECKED = 20;

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
  const [{ data: waiting }, { data: held }] = await Promise.all([
    pick("queued", JOBS_PER_PASS),
    pick("running", HELD_JOBS_CHECKED),
  ]);
  // A holder that stopped mid-batch is detected by its lease; the job is failed, never finished short.
  for (const job of (held ?? []) as unknown as JobRow[]) {
    if (leaseExpired(job.params.leaseStartedAt, new Date())) {
      await failJob(admin, job, "running").catch(() => {});
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
