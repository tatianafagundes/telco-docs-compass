// One step of a document's processing, decided by the pure file-hook rules and written guarded on
// state, current version and attempt (file-hooks spec R4.1–R4.4, BR-153 to BR-157).
// The server function in pipeline.functions.ts gives it the storage download; tests give a fake one.
import type { Json } from "@/integrations/supabase/types";
import type { PipelineState } from "@/schemas/document";
import { can, seamError, type SeamErr, type SeamResult } from "@/services/document-rules";
import { updateDocumentIf } from "@/services/document-update";
import { readDetail, type Step } from "@/services/file-hook-detail";
import {
  stepTransition,
  type StepInput,
  type StepOwner,
  type StepRefusal,
} from "@/services/file-hook-rules";
import { sha256Bytes } from "@/services/gateway-create-input";
import { audit, forbidden, type WriteEnv } from "@/services/seam-runtime";
import { simulatedOutcome } from "@/services/upload-rules";

export interface StepDeps {
  /** The stored file, or null when it is not there (yet). */
  download: (path: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  now: () => string;
  /** Who handles each step if it starts now. Until the organisation switch exists, both are simulated. */
  owners: () => Promise<Record<Step, StepOwner>>;
}
export interface StepAnswer {
  id: string;
  state: PipelineState;
  retried: boolean;
  /** The step waits for an outside system: the browser stops advancing it (R4.2). */
  waiting?: true;
}
const fail = (
  code: string,
  category: "rejected" | "conflict" | "unavailable" = "rejected",
): SeamErr => ({
  ok: false,
  error: seamError(code, category, category === "rejected" ? "none" : "retry"),
});
const REFUSAL: Record<Exclude<StepRefusal, "externalPending">, SeamErr> = {
  wrongState: fail("pipeline.wrongState"),
  quarantined: fail("pipeline.quarantined"),
  quarantineFull: fail("pipeline.quarantined"),
  notRetryable: fail("pipeline.notRetryable"),
  notExternal: fail("pipeline.wrongState"),
  notYourStep: fail("pipeline.wrongState"),
  staleAttempt: fail("pipeline.changed", "conflict"),
  notYet: fail("pipeline.wrongState"),
  noVersion: fail("pipeline.notUploaded", "unavailable"),
  badDetail: fail("pipeline.badDetail"),
  replay: fail("pipeline.wrongState"),
};
export const SIMULATED_OWNERS = async (): Promise<Record<Step, StepOwner>> => ({
  scan: { mode: "simulated" },
  read: { mode: "simulated" },
});

/**
 * Moves a newly added document one step, or restarts the step that failed (`retry`). People with
 * edit rights only; seeded documents never move. A step waiting for an outside system is not
 * advanced here: the answer says `waiting` and nothing is written.
 */
export async function advanceStep(
  env: WriteEnv,
  input: { id: string; retry?: boolean | undefined },
  deps: StepDeps,
): Promise<SeamResult<StepAnswer>> {
  // Seeing a document (e.g. through a share) is not enough: processing needs edit rights in its own organisation.
  if (!can(env.role, "edit")) return forbidden();
  const { data: doc } = await env.admin
    .from("documents")
    .select("id, name, pipeline_state, pipeline_detail, current_version_id, created_by")
    .eq("id", input.id)
    .eq("tenant_id", env.tenantId)
    .maybeSingle();
  if (!doc) return { ok: false, error: seamError("doc.notFound", "notFound") };
  if (!doc.created_by) return fail("pipeline.seeded");
  const state = doc.pipeline_state as PipelineState;
  const retried = Boolean(input.retry);
  if (retried && state !== "failed") return fail("pipeline.retry.notFailed");
  if (!retried && state !== "uploading" && state !== "scanning" && state !== "reading")
    return { ok: true, data: { id: doc.id, state, retried } };
  // The version must be this document's, in this tenant (R6.1).
  const { data: version } = doc.current_version_id
    ? await env.admin
        .from("document_versions")
        .select("id, storage_path, content_hash")
        .eq("id", doc.current_version_id)
        .eq("document_id", doc.id)
        .eq("tenant_id", env.tenantId)
        .maybeSingle()
    : { data: null };
  if (!version) return fail("pipeline.notUploaded", "unavailable");
  if (!retried && readDetail(doc.pipeline_detail).mode === "external" && state !== "uploading")
    return { ok: true, data: { id: doc.id, state, retried, waiting: true } };

  let step: StepInput;
  if (retried) step = { kind: "retry" };
  else {
    const file = version.storage_path ? await deps.download(version.storage_path) : null;
    if (!file) return fail("pipeline.notUploaded", "unavailable");
    if (state === "uploading") {
      // The hash the events and the scanners rely on is computed here, never taken from the browser.
      if ((await sha256Bytes(file)) !== version.content_hash) return fail("pipeline.hashMismatch");
      step = { kind: "confirmed" };
    } else {
      const outcome = simulatedOutcome(doc.name, new TextDecoder("latin1").decode(file));
      step =
        state === "scanning"
          ? { kind: "scanResult", result: outcome === "quarantined" ? "infected" : "clean" }
          : { kind: "readResult", result: outcome === "unreadable" ? "unreadable" : "read" };
    }
  }
  const now = deps.now();
  const next = stepTransition(state, doc.pipeline_detail, step, {
    now,
    versionId: version.id,
    owner: await deps.owners(),
  });
  if (!next.ok) {
    if (next.code === "externalPending")
      return { ok: true, data: { id: doc.id, state, retried, waiting: true } };
    return REFUSAL[next.code];
  }
  const written = await updateDocumentIf(
    env.admin,
    {
      id: doc.id,
      tenantId: env.tenantId,
      expect: {
        pipeline_state: next.expect.state,
        current_version_id: next.expect.versionId,
        "pipeline_detail->>attempt": next.expect.attemptText,
      },
    },
    {
      pipeline_state: next.state,
      pipeline_detail: next.detail as unknown as Json,
      updated_at: now,
    },
    "moving a document to its next processing step",
  );
  if (!written) return fail("pipeline.changed", "conflict");
  await audit(env, "pipelineStateChange", doc.id, `${state} to ${next.state}`, version.id);
  return {
    ok: true,
    data: {
      id: doc.id,
      state: next.state,
      retried,
      ...(next.detail.mode === "external" ? { waiting: true as const } : {}),
    },
  };
}
