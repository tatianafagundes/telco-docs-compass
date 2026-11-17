// What one call of the scheduler does: advance bulk changes, then do the housekeeping.
//
// The two are independent: if bulk changes throw, housekeeping still runs, and the other way
// round. `ok` is false when either failed, so the route can answer 500 and the scheduler records
// the run as failed instead of looking healthy.
import { processBulkJobs } from "@/services/bulk-worker";
import { runMaintenance, type MaintenanceResult } from "@/services/maintenance";
import type { Db } from "@/services/seam-runtime";

/** A few rounds per call keeps large jobs moving without hitting the request time limit. */
export const BULK_ROUNDS_PER_CALL = 3;

export interface ScheduledRunResult extends MaintenanceResult {
  ok: boolean;
  processed: number;
  bulkFailed: boolean;
}

export async function runScheduled(admin: Db): Promise<ScheduledRunResult> {
  let processed = 0;
  let bulkFailed = false;
  try {
    for (let i = 0; i < BULK_ROUNDS_PER_CALL; i++) processed += await processBulkJobs(admin);
  } catch (e) {
    bulkFailed = true;
    console.error(
      JSON.stringify({ op: "scheduled.bulk", cause: e instanceof Error ? e.name : "unknown" }),
    );
  }
  const maintenance = await runMaintenance(admin);
  return {
    ...maintenance,
    ok: !bulkFailed && maintenance.failed.length === 0,
    processed,
    bulkFailed,
  };
}
