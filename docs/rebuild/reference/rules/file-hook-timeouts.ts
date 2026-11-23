// File hooks: when a step has waited too long (R4.7, D8), and when quarantines look wrong (R6.5).
// Pure: no I/O.
import type { PipelineState } from "@/schemas/document";
import { readDetail } from "@/services/file-hook-detail";

/** A step waiting for an outside system fails after this (D8). */
export const EXTERNAL_RESULT_TIMEOUT_MINUTES = 30;
/** An upload never confirmed fails after this (D8). */
export const UPLOAD_CONFIRM_TIMEOUT_HOURS = 24;
/** More quarantines than this from one key in an hour writes an alert-level log line (R6.5). */
export const QUARANTINE_ALERT_PER_HOUR = 20;

export interface WaitTimes {
  /** When the current version was created: an upload waits from then. */
  uploadStartedAt: string;
  /** The document's last change: an external step with no readable start time waits from then. */
  updatedAt: string;
}

/**
 * Whether a step that has not answered should now fail. Only uploads and steps waiting for an
 * outside system time out; a simulated step never does. An external step whose start time is missing
 * or unreadable counts from the document's last change, so it cannot wait forever. A time that cannot
 * be read at all counts as not yet.
 */
export function timedOut(
  state: PipelineState,
  rawDetail: unknown,
  times: WaitTimes,
  now: string,
): boolean {
  const t = Date.parse(now);
  if (state === "uploading")
    return t - Date.parse(times.uploadStartedAt) > UPLOAD_CONFIRM_TIMEOUT_HOURS * 3_600_000;
  const d = readDetail(rawDetail);
  if ((state === "scanning" || state === "reading") && d.mode === "external")
    return t - Date.parse(d.since ?? times.updatedAt) > EXTERNAL_RESULT_TIMEOUT_MINUTES * 60_000;
  return false;
}

/** An alert-level log line is due when one key's quarantines in the last hour pass the limit. */
export function quarantineAlertDue(quarantinesLastHour: number): boolean {
  return quarantinesLastHour > QUARANTINE_ALERT_PER_HOUR;
}
