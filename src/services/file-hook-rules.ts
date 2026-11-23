// File hooks: the pure rules (no I/O). What file events may carry, how a document's processing step
// moves, who may download a version, and when a step has waited too long.
// Spec: .kiro/specs/file-hooks (requirements R1–R4, decisions D1–D8).
import type { PipelineState } from "@/schemas/document";

export const FILE_EVENTS = [
  "DocumentFileStoredEvent",
  "DocumentFileReadyToReadEvent",
  "DocumentFilePurgedEvent",
] as const;
export type FileEvent = (typeof FILE_EVENTS)[number];
export function isFileEvent(t: string): t is FileEvent {
  return (FILE_EVENTS as readonly string[]).includes(t);
}

/** A step waiting for an outside system fails after this (D8). */
export const EXTERNAL_RESULT_TIMEOUT_MINUTES = 30;
/** An upload never confirmed fails after this (D8). */
export const UPLOAD_CONFIRM_TIMEOUT_HOURS = 24;
/** More quarantines than this from one key in an hour writes an alert-level log line (R6.5). */
export const QUARANTINE_ALERT_PER_HOUR = 20;
/** Quarantined versions kept on one document; more versions than this is not a real document. */
export const MAX_QUARANTINED_VERSIONS = 1000;
/** Largest attempt number read back; anything larger or malformed counts as 0 (as the trigger does). */
const MAX_ATTEMPT = 999_999_999;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isAttempt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_ATTEMPT;

// ---- Events out (R1.5, R1.6) ----

type Check = (v: unknown) => boolean;
const HASH = /^[A-Za-z0-9:+/=_-]{1,200}$/;
const MEDIA = /^[\w.+-]{1,63}\/[\w.+-]{1,63}$/;
/** The only keys, with their types, a file event may carry. Everything else is dropped. */
const WHITELIST: Record<FileEvent, Record<string, Check>> = {
  DocumentFileStoredEvent: {
    versionId: isUuid,
    contentHash: (v) => typeof v === "string" && HASH.test(v),
    sizeBytes: (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0,
    mediaType: (v) => typeof v === "string" && MEDIA.test(v),
    attempt: isAttempt,
  },
  DocumentFileReadyToReadEvent: { versionId: isUuid, attempt: isAttempt },
  DocumentFilePurgedEvent: {
    versionIds: (v) => Array.isArray(v) && v.length <= MAX_QUARANTINED_VERSIONS && v.every(isUuid),
  },
};

/**
 * The payload of a file event as delivered: only whitelisted keys with the right type, read as own
 * properties (an inherited or `__proto__` key never passes). A key with a wrong type is left out.
 */
export function fileEventPayload(type: FileEvent, payload: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return out;
  for (const [key, ok] of Object.entries(WHITELIST[type])) {
    if (!Object.hasOwn(payload, key)) continue;
    const v = (payload as Record<string, unknown>)[key];
    if (ok(v)) out[key] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

// ---- pipeline_detail ----

export type Step = "scan" | "read";
export type Mode = "simulated" | "external";
export type FailReason = "threat" | "scanError" | "noResult" | "unreadable" | "noFile";
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
}
const REASONS: readonly string[] = ["threat", "scanError", "noResult", "unreadable", "noFile"];
const MAX_BY_CHARS = 120;

/**
 * Reads `documents.pipeline_detail` as stored. Never throws: unknown or malformed parts are dropped,
 * a malformed attempt is 0. Older details used `unreadableAgain`; it reads as `unreadable` in step read.
 */
export function readDetail(raw: unknown): PipelineDetail {
  const r = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const own = (k: string) => (Object.hasOwn(r, k) ? r[k] : undefined);
  const legacy = own("reason") === "unreadableAgain";
  const reason = legacy ? "unreadable" : own("reason");
  const step = own("step");
  const q = own("quarantinedVersions");
  const d: PipelineDetail = {
    attempt: isAttempt(own("attempt")) ? (own("attempt") as number) : 0,
    quarantinedVersions: Array.isArray(q)
      ? [...new Set(q.filter(isUuid).map((v) => v.toLowerCase()))].slice(
          0,
          MAX_QUARANTINED_VERSIONS,
        )
      : [],
  };
  const mode = own("mode");
  if (mode === "simulated" || mode === "external") d.mode = mode;
  const by = own("by");
  if (typeof by === "string" && by.length > 0) d.by = by.slice(0, MAX_BY_CHARS);
  const byClient = own("byClient");
  if (typeof byClient === "string" && byClient.length > 0 && byClient.length <= 64)
    d.byClient = byClient;
  const since = own("since");
  if (typeof since === "string" && !Number.isNaN(Date.parse(since))) d.since = since;
  if (step === "scan" || step === "read") d.step = step;
  else if (legacy || reason === "unreadable") d.step = "read";
  if (typeof reason === "string" && REASONS.includes(reason)) d.reason = reason as FailReason;
  return d;
}

export function isQuarantined(detail: PipelineDetail, versionId: string): boolean {
  return detail.quarantinedVersions.includes(versionId.toLowerCase());
}

// ---- Step transitions (R2.4, R3.5, R4.4, R4.7, D5) ----

/** Who handles a step if it starts now: decided from the organisation switch by the caller (D1). */
export interface StepOwner {
  mode: Mode;
  by?: string;
  byClient?: string;
}
export type StepInput =
  | { kind: "confirmed" }
  | { kind: "scanResult"; result: "clean" | "infected" | "error" }
  | { kind: "readResult"; result: "read" | "unreadable" }
  | { kind: "timeout" }
  | { kind: "retry" };
export interface StepContext {
  now: string;
  /** The document's current version: the one the step is about. */
  versionId: string;
  owner: Record<Step, StepOwner>;
}
export type StepRefusal =
  "wrongState" | "quarantined" | "notRetryable" | "notExternal" | "noVersion";
export type StepOutcome =
  | {
      ok: true;
      state: PipelineState;
      detail: PipelineDetail;
      /** The write must be guarded on these: state and attempt as read, and the same current version. */
      expect: { state: PipelineState; attempt: number; versionId: string };
    }
  | { ok: false; code: StepRefusal };

function start(step: Step, prev: PipelineDetail, ctx: StepContext): PipelineDetail {
  const o = ctx.owner[step];
  return {
    mode: o.mode,
    ...(o.by ? { by: o.by.slice(0, MAX_BY_CHARS) } : {}),
    ...(o.byClient ? { byClient: o.byClient } : {}),
    since: ctx.now,
    step,
    attempt: Math.min(prev.attempt + 1, MAX_ATTEMPT),
    quarantinedVersions: prev.quarantinedVersions,
  };
}
function end(prev: PipelineDetail, extra: Partial<PipelineDetail> = {}): PipelineDetail {
  return {
    ...prev,
    ...extra,
    quarantinedVersions: extra.quarantinedVersions ?? prev.quarantinedVersions,
  };
}
const STEP_STATE: Record<Step, PipelineState> = { scan: "scanning", read: "reading" };

/**
 * The next state and detail of a document's processing, or why the input does not apply. Pure; the
 * caller writes the result guarded on `expect` so two racing inputs cannot both apply (R2.9).
 * A quarantined version never moves again (D5).
 */
export function stepTransition(
  state: PipelineState,
  rawDetail: unknown,
  input: StepInput,
  ctx: StepContext,
): StepOutcome {
  const prev = readDetail(rawDetail);
  if (!isUuid(ctx.versionId)) return { ok: false, code: "noVersion" };
  const ok = (next: PipelineState, detail: PipelineDetail): StepOutcome => ({
    ok: true,
    state: next,
    detail,
    expect: { state, attempt: prev.attempt, versionId: ctx.versionId },
  });
  if (state === "quarantined" || isQuarantined(prev, ctx.versionId))
    return { ok: false, code: "quarantined" };
  switch (input.kind) {
    case "confirmed":
      return state === "uploading"
        ? ok("scanning", start("scan", prev, ctx))
        : { ok: false, code: "wrongState" };
    case "scanResult":
      if (state !== "scanning") return { ok: false, code: "wrongState" };
      if (input.result === "clean") return ok("reading", start("read", prev, ctx));
      if (input.result === "infected")
        return ok(
          "quarantined",
          end(prev, {
            step: "scan",
            reason: "threat",
            quarantinedVersions: [...prev.quarantinedVersions, ctx.versionId.toLowerCase()].slice(
              -MAX_QUARANTINED_VERSIONS,
            ),
          }),
        );
      return ok("failed", end(prev, { step: "scan", reason: "scanError" }));
    case "readResult":
      if (state !== "reading") return { ok: false, code: "wrongState" };
      return input.result === "read"
        ? ok("ready", { attempt: prev.attempt, quarantinedVersions: prev.quarantinedVersions })
        : ok("failed", end(prev, { step: "read", reason: "unreadable" }));
    case "timeout":
      if (state === "uploading") return ok("failed", end(prev, { reason: "noFile" }));
      if (state !== "scanning" && state !== "reading") return { ok: false, code: "wrongState" };
      // Only a step waiting for an outside system times out; it never becomes clean or ready (R4.7).
      if (prev.mode !== "external") return { ok: false, code: "notExternal" };
      return ok(
        "failed",
        end(prev, { step: state === "scanning" ? "scan" : "read", reason: "noResult" }),
      );
    case "retry": {
      if (state !== "failed") return { ok: false, code: "wrongState" };
      // Old failures have no step: they were reading failures. A file that never arrived is added again.
      if (prev.reason === "noFile") return { ok: false, code: "notRetryable" };
      const step = prev.step ?? "read";
      return ok(STEP_STATE[step], start(step, prev, ctx));
    }
  }
}

/**
 * Whether a step that has not answered should now fail (R4.7). `uploadStartedAt` is when the current
 * version was created. A missing or unreadable time counts as not yet.
 */
export function timedOut(
  state: PipelineState,
  rawDetail: unknown,
  uploadStartedAt: string,
  now: string,
): boolean {
  const d = readDetail(rawDetail);
  const t = Date.parse(now);
  if (state === "uploading")
    return t - Date.parse(uploadStartedAt) > UPLOAD_CONFIRM_TIMEOUT_HOURS * 3_600_000;
  if ((state === "scanning" || state === "reading") && d.mode === "external" && d.since)
    return t - Date.parse(d.since) > EXTERNAL_RESULT_TIMEOUT_MINUTES * 60_000;
  return false;
}

/** An alert-level log line is due when one key's quarantines in the last hour pass the limit (R6.5). */
export function quarantineAlertDue(quarantinesLastHour: number): boolean {
  return quarantinesLastHour > QUARANTINE_ALERT_PER_HOUR;
}
