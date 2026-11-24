// File hooks, scheduled: a step that waited too long fails (file-hooks spec R4.7, D8). An upload
// never confirmed fails after UPLOAD_CONFIRM_TIMEOUT_HOURS (reason noFile); a step waiting for the
// organisation's own antivirus or reader fails after EXTERNAL_RESULT_TIMEOUT_MINUTES (reason
// noResult, that step). It never becomes clean or ready, and it does not depend on the system's key
// still being connected. Simulated steps never time out. Runs for every tenant from the scheduler.
import type { PipelineState } from "@/schemas/document";
import type { Json } from "@/integrations/supabase/types";
import { updateDocumentIf } from "@/services/document-update";
import { stepTransition, type StepOwner } from "@/services/file-hook-rules";
import { must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";

/** Most documents of each kind (uploads, outside steps) looked at in one run; the rest wait a minute. */
export const TIMEOUT_BATCH = 200;
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

async function candidates(admin: Db): Promise<Candidate[]> {
  const base = () =>
    admin.from("documents").select(COLS).is("deleted_at", null).is("purged_at", null);
  const [uploads, outside] = await Promise.all([
    base().eq("pipeline_state", "uploading").order("updated_at").limit(TIMEOUT_BATCH),
    base()
      .in("pipeline_state", ["scanning", "reading"])
      .eq("pipeline_detail->>mode", "external")
      .order("updated_at")
      .limit(TIMEOUT_BATCH),
  ]);
  const rows = [
    ...(must(uploads, "finding uploads waiting for their file") ?? []),
    ...(must(outside, "finding steps waiting for an outside system") ?? []),
  ] as Candidate[];
  // Seeded documents (no person and no system added them) never change state on their own.
  return rows.filter((d) => d.created_by || d.registered_by_client);
}

/** When each version was created: an upload waits from then. */
async function versionTimes(admin: Db, docs: Candidate[]): Promise<Map<string, string>> {
  const ids = [...new Set(docs.map((d) => d.current_version_id).filter((v): v is string => !!v))];
  if (!ids.length) return new Map();
  const rows = must(
    await admin.from("document_versions").select("id, document_id, created_at").in("id", ids),
    "reading when versions were created",
  );
  return new Map((rows ?? []).map((v) => [`${v.document_id}:${v.id}`, v.created_at]));
}

/** Fails every step that waited too long; answers how many moved. */
export async function timeOutWaitingSteps(admin: Db, now = new Date()): Promise<number> {
  const docs = await candidates(admin);
  if (!docs.length) return 0;
  const created = await versionTimes(admin, docs);
  const at = now.toISOString();
  const moved: { doc: Candidate; versionId: string; from: PipelineState }[] = [];
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
    if (written) moved.push({ doc, versionId: doc.current_version_id, from: doc.pipeline_state });
  }
  if (!moved.length) return 0;
  try {
    must(
      await admin.from("document_events").insert(
        moved.map((m) => ({
          tenant_id: m.doc.tenant_id,
          document_id: m.doc.id,
          version_id: m.versionId,
          actor: null,
          action: "pipelineStateChange",
          detail: `${m.from} to failed (no answer in time)`,
        })),
      ),
      "recording steps that waited too long",
    );
  } catch (e) {
    // The moves cannot be undone by a second run (those rows no longer match): say so loudly.
    console.error(
      JSON.stringify({ op: "maintenance", step: "stepTimeoutEvents", missingEvents: moved.length }),
    );
    throw e;
  }
  return moved.length;
}
