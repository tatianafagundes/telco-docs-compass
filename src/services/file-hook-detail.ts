// File hooks: reading `documents.pipeline_detail` (jsonb, no schema). Pure: no I/O.
import type { PipelineState } from "@/schemas/document";
import { cleanLabel } from "@/services/file-hook-text";

/** Quarantined versions one document can hold. Past this a new version is refused, never forgotten (D5). */
export const MAX_QUARANTINED_VERSIONS = 1000;
/** Longest system name kept on a step, in code points. */
export const MAX_SYSTEM_NAME_CHARS = 120;
export const MAX_ATTEMPT = 999_999_999;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const isAttempt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_ATTEMPT;
const CLIENT_ID = /^[\w-]{1,64}$/;

export type Step = "scan" | "read";
export type Mode = "simulated" | "external";
export type FailReason = "threat" | "scanError" | "noResult" | "unreadable" | "noFile";
/** The last result an outside system sent and that was applied: lets a lost reply be answered again. */
export interface LastResult {
  step: Step;
  attempt: number;
  result: string;
  byClient: string;
}
export interface PipelineDetail {
  mode?: Mode;
  /** Name of the outside system, shown to people. */
  by?: string;
  /** Id of the outside system's key; only that key may download or answer. */
  byClient?: string;
  since?: string;
  step?: Step;
  attempt: number;
  reason?: FailReason;
  quarantinedVersions: string[];
  lastResult?: LastResult;
}
const REASONS: readonly string[] = ["threat", "scanError", "noResult", "unreadable", "noFile"];
const RESULTS: readonly string[] = ["clean", "infected", "error", "read", "unreadable"];
/** The step a failure came from when an older detail did not record it. */
const STEP_OF_REASON: Partial<Record<FailReason, Step>> = {
  threat: "scan",
  scanError: "scan",
  unreadable: "read",
};

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}
const ownOf = (r: Record<string, unknown>) => (k: string) =>
  Object.hasOwn(r, k) ? r[k] : undefined;

/**
 * Reads `pipeline_detail` as stored. Never throws: unknown or malformed parts are dropped and a
 * malformed attempt is 0. The quarantine list is never shortened. Older details used
 * `unreadableAgain`; it reads as `unreadable`, and a missing step is taken from the reason.
 */
/**
 * The step a failure came from: the recorded one, else from the reason (readDetail fills that in);
 * a reason with no known step (an old timeout) may have been the scan, so it counts as the scan; a
 * failure with neither was an old reading failure. Try again restarts this step.
 */
export function failedStep(d: PipelineDetail): Step {
  return d.step ?? (d.reason === undefined ? "read" : "scan");
}
/**
 * Whether a failed file passed the scan: only a reading failure, never a file that did not arrive.
 * Keep without reading and downloads by people both rely on it.
 */
export function failedAfterCheck(d: PipelineDetail): boolean {
  return d.reason !== "noFile" && failedStep(d) === "read";
}
export function readDetail(raw: unknown): PipelineDetail {
  const own = ownOf(asRecord(raw));
  const legacy = own("reason") === "unreadableAgain";
  const r = legacy ? "unreadable" : own("reason");
  const reason = typeof r === "string" && REASONS.includes(r) ? (r as FailReason) : undefined;
  const q = own("quarantinedVersions");
  const d: PipelineDetail = {
    attempt: isAttempt(own("attempt")) ? (own("attempt") as number) : 0,
    quarantinedVersions: Array.isArray(q)
      ? [...new Set(q.filter(isUuid).map((v) => v.toLowerCase()))]
      : [],
  };
  const mode = own("mode");
  if (mode === "simulated" || mode === "external") d.mode = mode;
  const by = own("by");
  if (typeof by === "string" && by.length > 0) d.by = cleanLabel(by, MAX_SYSTEM_NAME_CHARS);
  const byClient = own("byClient");
  if (typeof byClient === "string" && CLIENT_ID.test(byClient)) d.byClient = byClient;
  const since = own("since");
  if (typeof since === "string" && !Number.isNaN(Date.parse(since))) d.since = since;
  const step = own("step");
  if (step === "scan" || step === "read") d.step = step;
  else if (reason && STEP_OF_REASON[reason]) d.step = STEP_OF_REASON[reason];
  if (reason) d.reason = reason;
  const lr = ownOf(asRecord(own("lastResult")));
  const lrStep = lr("step");
  const lrResult = lr("result");
  const lrClient = lr("byClient");
  if (
    (lrStep === "scan" || lrStep === "read") &&
    isAttempt(lr("attempt")) &&
    typeof lrResult === "string" &&
    RESULTS.includes(lrResult) &&
    typeof lrClient === "string" &&
    CLIENT_ID.test(lrClient)
  )
    d.lastResult = {
      step: lrStep,
      attempt: lr("attempt") as number,
      result: lrResult,
      byClient: lrClient,
    };
  return d;
}

/**
 * The attempt exactly as `pipeline_detail->>'attempt'` reads in the database, so a guarded write can
 * compare it: null when missing or JSON null, the decimal text for an attempt (0 to MAX_ATTEMPT).
 * Anything else (text such as "3", negative or larger numbers, objects, arrays, booleans) is `undefined`: this code never writes
 * it, it would read as attempt 0 and count backwards, so the change is refused rather than guessed.
 */
export function storedAttemptText(raw: unknown): string | null | undefined {
  const v = ownOf(asRecord(raw))("attempt");
  if (v === undefined || v === null) return null;
  if (isAttempt(v)) return String(v);
  return undefined;
}

export function isQuarantined(detail: PipelineDetail, versionId: string | null): boolean {
  return versionId !== null && detail.quarantinedVersions.includes(versionId.toLowerCase());
}
/**
 * The quarantine list to carry onto a new version or a restore (D5). A document quarantined before
 * the list existed has its current version added, so it stays blocked once another version is current.
 */
export function carriedQuarantine(
  state: PipelineState,
  rawDetail: unknown,
  currentVersionId: string | null,
): string[] {
  const list = readDetail(rawDetail).quarantinedVersions;
  const cur = currentVersionId?.toLowerCase();
  return state === "quarantined" && cur && isUuid(cur) && !list.includes(cur)
    ? [...list, cur]
    : list;
}
/** A new version can be added only while the quarantine list has room (D5: it is never shortened). */
export function quarantineHasRoom(list: string[]): boolean {
  return list.length < MAX_QUARANTINED_VERSIONS;
}
