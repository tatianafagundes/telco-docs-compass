// How a bulk job is claimed, held, failed and settled (its status is its lease). The batch work
// itself is in bulk-worker.ts.

import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import { type AppRole } from "@/services/document-rules";
import type { Db } from "@/services/seam-runtime";
import { must } from "@/services/shared/must";
import { type BulkAction } from "@/services/search-rules";
export interface JobRow {
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

export const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
export const withoutLease = (p: JobRow["params"]) => {
  const { leaseStartedAt: _lease, ...rest } = p;
  return rest as Json;
};

/**
 * Marks the job failed, but only if it is still in the state this processor saw (`from`, same
 * `done`). A late or mistaken call can therefore never kill a job another processor is running.
 */
export async function failJob(admin: Db, job: JobRow, from: "queued" | "running") {
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
export async function currentRole(admin: Db, job: JobRow): Promise<AppRole | null> {
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
export async function claimJob(admin: Db, job: JobRow): Promise<boolean> {
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
export async function settleJob(admin: Db, job: JobRow) {
  if (job.changed + sum(job.skipped) !== job.total) return failJob(admin, job, "queued");
  must(
    await admin
      .from("bulk_jobs")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "queued"),
    "marking a bulk job done",
  );
}
