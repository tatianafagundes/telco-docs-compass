// What the screens say and offer for a document's processing (file-hooks spec R5.1–R5.5). Pure: the
// upload card, the record list and the document panel all read it, so they never disagree.
import type { PipelineState } from "@/schemas/document";
import { PIPELINE_LABEL, storedPipelineLabel } from "@/lib/document-labels";
import { readDetail, type PipelineDetail } from "@/services/file-hook-detail";
import { EXTERNAL_RESULT_TIMEOUT_MINUTES } from "@/services/file-hook-timeouts";
import { middleTruncate } from "@/services/upload-rules";

/** Longest system name shown on a line, in characters (middle-truncated). */
export const SYSTEM_NAME_CHARS = 32;
export type ProcessingAction = "retry" | "keepUnread" | "report" | "delete";
export interface ProcessingView {
  /** The tag: names the step that failed, so a file never checked never reads as a reading problem. */
  label: string;
  /** Set while a step waits for the organisation's own antivirus or reader. */
  waiting: { system: string; since: string | null } | null;
  /** The "Scan is simulated" tooltip: only while a built-in step runs. */
  simulated: boolean;
  /** What happened and what to do, for a failed or blocked file. */
  message: string | null;
  actions: ProcessingAction[];
}

/** The system a step was recorded with, or what it stands for when none was recorded. */
function nameOf(d: PipelineDetail, step: "scan" | "read", max: number): string {
  if (d.by) return middleTruncate(d.by, max);
  if (d.mode === "external")
    return step === "scan" ? "Your organisation's antivirus" : "Your organisation's reader";
  return step === "scan" ? "The built-in check" : "The built-in reader";
}

/** The tag of a failed document by what failed: the check, the reading, or the file itself. */
function failedLabel(d: PipelineDetail): string {
  if (d.reason === "noFile") return "No file yet";
  const scan =
    d.step === "scan" || d.reason === "scanError" || (d.reason === "noResult" && d.step !== "read");
  return scan ? "Couldn't check" : PIPELINE_LABEL.failed;
}

export interface ViewOptions {
  /** This page is sending the file right now (else an upload means the file never arrived). */
  uploadingHere?: boolean;
  /** Longest system name, in characters: 32 in the card and the table, more in the panel. */
  nameChars?: number;
}
export function processingView(
  state: PipelineState,
  rawDetail: unknown,
  opts: ViewOptions = {},
): ProcessingView {
  const d = readDetail(rawDetail);
  const max = opts.nameChars ?? SYSTEM_NAME_CHARS;
  const systemName = (dd: PipelineDetail, step: "scan" | "read") => nameOf(dd, step, max);
  const none: ProcessingView = {
    label:
      state === "failed" ? failedLabel(d) : storedPipelineLabel(state, opts.uploadingHere ?? false),
    waiting: null,
    simulated: false,
    message: null,
    actions: [],
  };
  if (state === "scanning" || state === "reading") {
    const step = state === "scanning" ? "scan" : "read";
    if (d.mode === "external")
      return { ...none, waiting: { system: systemName(d, step), since: d.since ?? null } };
    return { ...none, simulated: true };
  }
  if (state === "quarantined")
    return {
      ...none,
      message: `${systemName(d, "scan")} found a possible threat in this file. It's blocked: nobody can open or download it. To use this document again, add a clean new version.`,
      actions: ["report", "delete"],
    };
  if (state !== "failed") return none;
  const n = EXTERNAL_RESULT_TIMEOUT_MINUTES;
  switch (d.reason) {
    case "noFile":
      return { ...none, message: "The file never arrived. Add it again.", actions: ["delete"] };
    case "scanError":
      return {
        ...none,
        message: `${systemName(d, "scan")} couldn't check this file. Try again.`,
        actions: ["retry", "delete"],
      };
    case "noResult":
      // A timeout that recorded no step may have been the scan: Try again scans again, and the
      // file cannot be kept unread (the retry and keep rules read it the same way).
      return d.step !== "read"
        ? {
            ...none,
            message: `${systemName(d, "scan")} didn't answer within ${n} minutes. Try again.`,
            actions: ["retry", "delete"],
          }
        : {
            ...none,
            message: `${systemName(d, "read")} didn't answer within ${n} minutes. Try again, or keep the file without reading.`,
            actions: ["retry", "keepUnread", "delete"],
          };
    default:
      // unreadable, and older failures that recorded no reason (they were reading failures).
      if (d.step === "scan")
        return {
          ...none,
          message: `${systemName(d, "scan")} couldn't check this file. Try again.`,
          actions: ["retry", "delete"],
        };
      return {
        ...none,
        message: "We couldn't read the text in this file, so no details were filled in.",
        actions: ["retry", "keepUnread", "delete"],
      };
  }
}

/** "Waiting for Acme AV · Since 14:05" (local time), or without the time when none was recorded. */
export function waitingLine(w: NonNullable<ProcessingView["waiting"]>): string {
  if (!w.since) return `Waiting for ${w.system}`;
  const t = new Date(w.since);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `Waiting for ${w.system} · Since ${hh}:${mm}`;
}

/** Refetch every 5 s while a shown document waits, every 15 s once every wait is 2 minutes old. */
export const POLL_FAST_MS = 5_000;
export const POLL_SLOW_MS = 15_000;
export const POLL_SLOW_AFTER_MS = 120_000;
export interface PolledDoc {
  pipeline_state: PipelineState;
  pipeline_detail?: unknown;
}
export function pollDelay(docs: readonly PolledDoc[], now: number): number | false {
  let waiting = false;
  for (const doc of docs) {
    if (doc.pipeline_state !== "scanning" && doc.pipeline_state !== "reading") continue;
    const d = readDetail(doc.pipeline_detail);
    if (d.mode !== "external") continue;
    waiting = true;
    // A wait with no readable start counts as new: it is checked often rather than late.
    if (!d.since || now - Date.parse(d.since) < POLL_SLOW_AFTER_MS) return POLL_FAST_MS;
  }
  return waiting ? POLL_SLOW_MS : false;
}

/** How a state change is announced: failures and blocked files interrupt, the rest wait. */
export interface Announcement {
  text: string;
  urgent: boolean;
}
/**
 * The announcements for what changed since the last list, once per change. Documents seen for the
 * first time are not announced (the list just loaded or another page added them).
 */
export function announcements(
  before: ReadonlyMap<string, PipelineState>,
  docs: readonly {
    id: string;
    name: string;
    pipeline_state: PipelineState;
    pipeline_detail?: unknown;
  }[],
): Announcement[] {
  const out: Announcement[] = [];
  for (const doc of docs) {
    const was = before.get(doc.id);
    if (was === undefined || was === doc.pipeline_state) continue;
    const urgent = doc.pipeline_state === "failed" || doc.pipeline_state === "quarantined";
    // The words on screen, and for a failure or a blocked file what happened (design review S9).
    const v = processingView(doc.pipeline_state, doc.pipeline_detail, { uploadingHere: true });
    const what = v.label.toLowerCase();
    const first = urgent && v.message ? ` ${v.message.split(/(?<=\.) /)[0]}` : "";
    out.push({ text: `${middleTruncate(doc.name, 48)}: ${what}.${first}`, urgent });
  }
  return out;
}
