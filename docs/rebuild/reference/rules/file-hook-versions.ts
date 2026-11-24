// File hooks: what a new version, a restore and "Keep without reading" do to a document's processing
// (R4.8, R5.2, D5). Pure: no I/O.
import type { PipelineState } from "@/schemas/document";
import {
  carriedQuarantine,
  isQuarantined,
  quarantineHasRoom,
  readDetail,
  storedAttemptText,
  type PipelineDetail,
} from "@/services/file-hook-detail";

/** Guard for a write decided from an earlier read: state, current version and stored attempt as read. */
export interface ReadGuard {
  pipeline_state: PipelineState;
  current_version_id: string | null;
  "pipeline_detail->>attempt": string | null;
}

export type VersionStart =
  | {
      ok: true;
      state: "uploading";
      detail: Pick<PipelineDetail, "attempt" | "quarantinedVersions">;
      expect: ReadGuard;
    }
  | { ok: false; code: "quarantined" | "quarantineFull" | "badDetail" };

/**
 * A new or restored version starts processing again from `uploading`, keeping every quarantined
 * version (D5) and the attempt count (a late answer about an earlier attempt never matches a new one).
 * A quarantined version can never be restored, and a full quarantine list refuses a new version
 * rather than forget one. The caller writes it guarded on `expect`.
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
  const attemptText = storedAttemptText(rawDetail);
  if (attemptText === undefined) return { ok: false, code: "badDetail" };
  return {
    ok: true,
    state: "uploading",
    detail: { attempt: readDetail(rawDetail).attempt, quarantinedVersions: list },
    expect: {
      pipeline_state: state,
      current_version_id: currentVersionId,
      "pipeline_detail->>attempt": attemptText,
    },
  };
}

export type KeepUnread =
  | {
      ok: true;
      detail: { note: "notRead"; attempt: number; quarantinedVersions: string[] };
      expect: ReadGuard;
    }
  | { ok: false; code: "notFailed" | "notReadingFailure" | "badDetail" };

/**
 * "Keep without reading" accepts a file whose reading failed. Never a failed or unanswered scan, and
 * never a file that did not arrive: the file must have been checked (R5.2). Older failures without a
 * step were reading failures. The quarantine list and attempt are kept. The caller writes it guarded
 * on `expect`, so a version added meanwhile is never marked ready unchecked.
 */
export function keepUnread(
  state: PipelineState,
  rawDetail: unknown,
  currentVersionId: string | null,
): KeepUnread {
  if (state !== "failed") return { ok: false, code: "notFailed" };
  const d = readDetail(rawDetail);
  // Old failures with neither step nor reason were reading; a reason with no known step (a
  // timeout) may have been the scan, so the file may never have been checked.
  const reading = d.step === "read" || (d.step === undefined && d.reason === undefined);
  if (d.reason === "noFile" || !reading) return { ok: false, code: "notReadingFailure" };
  // A quarantined version is never made ready (D5), whatever the failure says.
  if (isQuarantined(d, currentVersionId)) return { ok: false, code: "notReadingFailure" };
  const attemptText = storedAttemptText(rawDetail);
  if (attemptText === undefined) return { ok: false, code: "badDetail" };
  return {
    ok: true,
    detail: { note: "notRead", attempt: d.attempt, quarantinedVersions: d.quarantinedVersions },
    expect: {
      pipeline_state: "failed",
      current_version_id: currentVersionId,
      "pipeline_detail->>attempt": attemptText,
    },
  };
}
