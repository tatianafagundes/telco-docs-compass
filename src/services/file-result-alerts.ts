// File hooks: an alert when the organisation's antivirus blocks files at a rate more likely wrong or
// compromised than right (file-hooks spec R6.5). An organisation has one antivirus key (BR-163), so
// its infected results in the last hour are that key's. The log line carries ids and counts only,
// never a file, document or threat name.
import { QUARANTINE_ALERT_PER_HOUR, quarantineAlertDue } from "@/services/file-hook-timeouts";
import type { SystemCtx } from "@/services/gateway-core";
import { DatabaseError } from "@/services/shared/must";

/** How an infected result is recorded in the activity log (gateway-file-results.ts). */
export const INFECTED_DETAIL_PREFIX = "Scan infected";

/**
 * Counts this hour's infected results and logs an alert past the limit, on every infected result
 * past it (alerting deduplicates; logging only on crossing would miss it under concurrent results).
 * Never throws.
 */
export async function checkQuarantineRate(ctx: SystemCtx, now = new Date()): Promise<void> {
  try {
    const since = new Date(now.getTime() - 3_600_000).toISOString();
    const { count, error } = await ctx.admin
      .from("document_events")
      .select("id", { count: "exact" })
      .eq("tenant_id", ctx.tenantId)
      .eq("action", "scanResult")
      .like("detail", `${INFECTED_DETAIL_PREFIX}%`)
      .gte("created_at", since)
      .limit(1);
    if (error) throw new DatabaseError("counting quarantines in the last hour");
    const infected = count ?? 0;
    if (!quarantineAlertDue(infected)) return;
    console.error(
      JSON.stringify({
        level: "alert",
        op: "fileHooks.quarantineRate",
        tenant: ctx.tenantId,
        client: ctx.clientId,
        quarantinesLastHour: infected,
        limit: QUARANTINE_ALERT_PER_HOUR,
      }),
    );
  } catch (e) {
    // The result is already applied; a failed count must not change the answer.
    console.error(
      JSON.stringify({
        op: "fileHooks.quarantineRate",
        // A fixed word: an unexpected error's message is never logged here.
        step: e instanceof DatabaseError ? e.message : "countFailed",
      }),
    );
  }
}
