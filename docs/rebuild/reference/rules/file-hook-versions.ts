// File hooks: what a new version, a restore and "Keep without reading" do to a document's processing
// (R4.8, R5.2, D5). Pure: no I/O.
import type { PipelineState } from "@/schemas/document";
import {
  carriedQuarantine,
  quarantineHasRoom,
  readDetail,
  type PipelineDetail,
} from "@/services/file-hook-detail";

export type VersionStart =
  | { ok: true; state: "uploading"; detail: Pick<PipelineDetail, "quarantinedVersions"> }
  | { ok: false; code: "quarantined" | "quarantineFull" };

/**
 * A new or restored version starts processing again from `uploading`, keeping every quarantined
 * version (D5). A quarantined version can never be restored, and a full quarantine list refuses a
 * new version rather than forget one.
 */
export function versionStart(
  state: PipelineState,
  rawDetail: unknown,
  currentVersionId: string | null,
  restoreFromVersionId?: string,
): VersionStart {
  const list = carriedQuarantine(state, rawDetail, currentVersionId);
  if (restoreFromVersionId && list.includes(restoreFromVersionId.toLowerCase()))
    return { ok: false, code: "quarantined" };
  if (!quarantineHasRoom(list)) return { ok: false, code: "quarantineFull" };
  return { ok: true, state: "uploading", detail: { quarantinedVersions: list } };
}

export type KeepUnread =
  | { ok: true; detail: { note: "notRead"; quarantinedVersions: string[] } }
  | { ok: false; code: "notFailed" | "notReadingFailure" };

/**
 * "Keep without reading" accepts a file whose reading failed. Never a failed or unanswered scan, and
 * never a file that did not arrive: the file must have been checked (R5.2). Older failures without a
 * step were reading failures. The quarantine list is kept.
 */
export function keepUnread(state: PipelineState, rawDetail: unknown): KeepUnread {
  if (state !== "failed") return { ok: false, code: "notFailed" };
  const d = readDetail(rawDetail);
  if (d.reason === "noFile" || (d.step ?? "read") !== "read")
    return { ok: false, code: "notReadingFailure" };
  return { ok: true, detail: { note: "notRead", quarantinedVersions: d.quarantinedVersions } };
}
