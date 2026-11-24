// File hooks, scheduled: a step that waited too long fails (file-hooks spec R4.7, D8). An upload
// never confirmed fails after UPLOAD_CONFIRM_TIMEOUT_HOURS (reason noFile); a step waiting for the
// organisation's own antivirus or reader fails after EXTERNAL_RESULT_TIMEOUT_MINUTES (reason
// noResult, that step). It never becomes clean or ready, and it does not depend on the system's key
// still being connected. Simulated steps never time out. Runs for every tenant from the scheduler.
import type { PipelineState } from "@/schemas/document";
import type { Json } from "@/integrations/supabase/types";
import { updateDocumentIf } from "@/services/document-update";
import { stepTransition, type StepOwner } from "@/services/file-hook-rules";
import {
  EXTERNAL_RESULT_TIMEOUT_MINUTES,
  UPLOAD_CONFIRM_TIMEOUT_HOURS,
} from "@/services/file-hook-timeouts";
import { must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";

/** Most documents of each kind (uploads, outside steps) looked at in one run; the rest wait a minute. */
export const TIMEOUT_BATCH = 200;
/** Version ids per lookup: about 2 KB of address. */
export const VERSION_LOOKUP_CHUNK = 50;
const SIMULATED: Record<"scan" | "read", StepOwner> = {
  scan: { mode: "simulated" },
  read: { mode: "simulated" },
};
const COLS =
  "id, tenant_id, pipeline_state, pipeline_detail, current_version_id, updated_at, created_by, registered_by_client";
interface Candidate {
  id: string;
  tenant_id: string;
  pipeline_state: PipelineState;
  pipeline_detail: unknown;
  current_version_id: string | null;
  updated_at: string;
  created_by: string | null;
  registered_by_client: string | null;
}

/**
 * Documents that may be due, filtered in the query so a batch is not filled by rows that will not
 * move (code review M1): seeded documents and documents without a version are left out, and only
 * rows whose wait can be over are read. An upload is read once its document has not changed for
 * the upload timeout (its version is never newer than that change), so an upload edited meanwhile
 * waits until that long after the edit at most. An outside step is read once its start time or its
 * document's last change is past the step timeout.
 */
async function candidates(admin: Db, now: Date): Promise<Candidate[]> {
  const uploadCutoff = new Date(
    now.getTime() - UPLOAD_CONFIRM_TIMEOUT_HOURS * 3_600_000,
  ).toISOString();
  const stepCutoff = new Date(
    now.getTime() - EXTERNAL_RESULT_TIMEOUT_MINUTES * 60_000,
  ).toISOString();
  const base = () =>
    admin
      .from("documents")
      .select(COLS)
      .is("deleted_at", null)
      .is("purged_at", null)
      .not("current_version_id", "is", null);
  const [uploads, outside] = await Promise.all([
    base()
      .eq("pipeline_state", "uploading")
      .lt("updated_at", uploadCutoff)
      // Seeded documents (no person and no system added them) never change state on their own.
      .or("created_by.not.is.null,registered_by_client.not.is.null")
      .order("updated_at")
      .limit(TIMEOUT_BATCH),
    // Only a started step is external, and seeded documents never start one.
    base()
      .in("pipeline_state", ["scanning", "reading"])
      .eq("pipeline_detail->>mode", "external")
      // Quoted: a timestamp holds `.` and `:`, which PostgREST reads as syntax in an `or` list.
      .or(`updated_at.lt."${stepCutoff}",pipeline_detail->>since.lt."${stepCutoff}"`)
      .order("updated_at")
      .limit(TIMEOUT_BATCH),
  ]);
  const rows = [
    ...(must(uploads, "finding uploads waiting for their file") ?? []),
    ...(must(outside, "finding steps waiting for an outside system") ?? []),
  ] as Candidate[];
  return rows.filter((d) => d.created_by || d.registered_by_client);
}

/** When each version was created: an upload waits from then. */
async function versionTimes(admin: Db, docs: Candidate[]): Promise<Map<string, string>> {
  const ids = [...new Set(docs.map((d) => d.current_version_id).filter((v): v is string => !!v))];
  if (!ids.length) return new Map();
  // In small lists: hundreds of ids in one address can pass the request-line limit (final seg M3).
  const rows: { id: string; document_id: string; created_at: string }[] = [];
  for (let i = 0; i < ids.length; i += VERSION_LOOKUP_CHUNK) {
    const part = must(
      await admin
        .from("document_versions")
        .select("id, document_id, created_at")
        .in("id", ids.slice(i, i + VERSION_LOOKUP_CHUNK)),
      "reading when versions were created",
    );
    rows.push(...(part ?? []));
  }
  return new Map(rows.map((v) => [`${v.document_id}:${v.id}`, v.created_at]));
}

/** Records the steps that failed, against their version. A failed record is reported with the ids. */
async function recordTimeouts(admin: Db, moved: Moved[]): Promise<void> {
  if (!moved.length) return;
  try {
    must(
      await admin.from("document_events").insert(
        moved.map((m) => ({
          tenant_id: m.tenantId,
          document_id: m.id,
          version_id: m.versionId,
          actor: null,
          action: "pipelineStateChange",
          detail: `${m.from} to failed (no answer in time)`,
        })),
      ),
      "recording steps that waited too long",
    );
  } catch (e) {
    // The moves cannot be undone by a second run (those rows no longer match): name them for a backfill.
    console.error(
      JSON.stringify({
        op: "maintenance",
        step: "stepTimeoutEvents",
        missingEvents: moved.length,
        documents: moved.map((m) => m.id),
      }),
    );
    throw e;
  }
}
interface Moved {
  id: string;
  tenantId: string;
  versionId: string;
  from: PipelineState;
}

/** Fails every step that waited too long; answers how many moved. */
export async function timeOutWaitingSteps(admin: Db, now = new Date()): Promise<number> {
  const docs = await candidates(admin, now);
  if (!docs.length) return 0;
  const created = await versionTimes(admin, docs);
  const at = now.toISOString();
  const moved: Moved[] = [];
  try {
    for (const doc of docs) {
      if (!doc.current_version_id) continue;
      const uploadStartedAt = created.get(`${doc.id}:${doc.current_version_id}`);
      // A version of another document is never this one's (R6.1): no time, no move.
      if (!uploadStartedAt) continue;
      const next = stepTransition(
        doc.pipeline_state,
        doc.pipeline_detail,
        { kind: "timeout" },
        {
          now: at,
          versionId: doc.current_version_id,
          owner: SIMULATED,
          times: { uploadStartedAt, updatedAt: doc.updated_at },
        },
      );
      if (!next.ok) continue;
      const written = await updateDocumentIf(
        admin,
        {
          id: doc.id,
          tenantId: doc.tenant_id,
          expect: {
            pipeline_state: next.expect.state,
            current_version_id: next.expect.versionId,
            "pipeline_detail->>attempt": next.expect.attemptText,
          },
        },
        {
          pipeline_state: next.state,
          pipeline_detail: next.detail as unknown as Json,
          updated_at: at,
        },
        "failing a step that waited too long",
      );
      if (written)
        moved.push({
          id: doc.id,
          tenantId: doc.tenant_id,
          versionId: doc.current_version_id,
          from: doc.pipeline_state,
        });
    }
  } finally {
    // Even when a later write fails, the documents already moved get their record (code review S1).
    await recordTimeouts(admin, moved);
  }
  if (docs.length >= TIMEOUT_BATCH && !moved.length)
    console.error(
      JSON.stringify({ op: "maintenance", step: "stepTimeouts", noProgress: docs.length }),
    );
  return moved.length;
}
