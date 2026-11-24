// File hooks: what the scan and extraction answers share. The document and version they are about
// (pinned to the key's organisation), the HTTP answer for each refusal, and the guarded write
// (file-hooks spec R2.3, R2.9, R3.2, R6.1).
import type { PipelineState } from "@/schemas/document";
import type { Json } from "@/integrations/supabase/types";
import { updateDocumentIf } from "@/services/document-update";
import { isUuid } from "@/services/file-hook-detail";
import type { StepOutcome, StepRefusal } from "@/services/file-hook-rules";
import type { SystemCtx } from "@/services/gateway-core";
import { tmfError } from "@/services/tmf667-mapper";

export interface Target {
  doc: {
    id: string;
    pipeline_state: PipelineState;
    pipeline_detail: unknown;
    current_version_id: string | null;
    document_type: string;
    registered_by_client: string | null;
  };
  version: {
    id: string;
    content_hash: string;
    storage_path: string | null;
    size_bytes: number | null;
  };
}
export type Answer = { status: number; body: unknown };
/** One answer for an unknown document, another organisation's, and an unknown version. */
export const NOT_FOUND: Answer = {
  status: 404,
  body: tmfError(404, "notFound", "Not Found", "No document with this id and attachment."),
};

export async function loadTarget(
  ctx: SystemCtx,
  documentId: string,
  versionId: string,
): Promise<Target | null> {
  if (!isUuid(documentId) || !isUuid(versionId)) return null;
  const [{ data: doc }, { data: version }] = await Promise.all([
    ctx.admin
      .from("documents")
      .select(
        "id, pipeline_state, pipeline_detail, current_version_id, document_type, registered_by_client",
      )
      .eq("id", documentId)
      .eq("tenant_id", ctx.tenantId)
      .is("deleted_at", null)
      .is("purged_at", null)
      .maybeSingle(),
    ctx.admin
      .from("document_versions")
      .select("id, content_hash, storage_path, size_bytes")
      .eq("id", versionId)
      .eq("document_id", documentId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle(),
  ]);
  return doc && version ? { doc: doc as Target["doc"], version } : null;
}

/** The current version only: an answer about an older one never moves the document (R2.3). */
export function notCurrent(t: Target): Answer | null {
  return t.doc.current_version_id?.toLowerCase() === t.version.id.toLowerCase()
    ? null
    : {
        status: 409,
        body: tmfError(
          409,
          "versionNotCurrent",
          "Conflict",
          "This is not the document's current version.",
        ),
      };
}

/** The HTTP answer for a refused result. `replay` is answered by the caller with the stored outcome. */
export function refusalAnswer(code: Exclude<StepRefusal, "replay">, step: "scan" | "read"): Answer {
  const conflict = (c: string, message: string): Answer => ({
    status: 409,
    body: tmfError(409, c, "Conflict", message),
  });
  switch (code) {
    case "staleAttempt":
      return conflict("staleAttempt", "This answer is for an earlier attempt or another version.");
    case "notYourStep":
      return conflict("notYourStep", "This file is not waiting for this system.");
    case "quarantined":
    case "quarantineFull":
      return conflict("quarantined", "This file is blocked: a threat was found in it.");
    case "badDetail":
      return conflict(
        "cannotProcess",
        "This document cannot be processed. Contact the organisation.",
      );
    default:
      return step === "scan"
        ? conflict(
            "notScanning",
            "This file is not waiting for a scan by this organisation's system.",
          )
        : conflict(
            "notReading",
            "This file is not waiting to be read by this organisation's system.",
          );
  }
}

/** The state change, guarded on the state, version and attempt that were read (R2.9). */
export async function writeOutcome(
  ctx: SystemCtx,
  documentId: string,
  next: Extract<StepOutcome, { ok: true }>,
): Promise<boolean> {
  return updateDocumentIf(
    ctx.admin,
    {
      id: documentId,
      tenantId: ctx.tenantId,
      expect: {
        pipeline_state: next.expect.state,
        current_version_id: next.expect.versionId,
        "pipeline_detail->>attempt": next.expect.attemptText,
      },
    },
    {
      pipeline_state: next.state,
      pipeline_detail: next.detail as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    "recording a file result",
  );
}
export const CHANGED: Answer = {
  status: 409,
  body: tmfError(
    409,
    "changedMeanwhile",
    "Conflict",
    "The document changed meanwhile. Read it and try again.",
  ),
};
