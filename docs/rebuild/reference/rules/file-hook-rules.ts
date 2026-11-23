// File hooks: what file events may carry (R1.5, R1.6) and how a document's processing step moves
// (R2.3–R2.9, R3.5, R4.2–R4.7, D5). Pure: no I/O. Spec: .kiro/specs/file-hooks.
import type { PipelineState } from "@/schemas/document";
import {
  isAttempt,
  isQuarantined,
  isUuid,
  MAX_ATTEMPT,
  MAX_QUARANTINED_VERSIONS,
  MAX_SYSTEM_NAME_CHARS,
  readDetail,
  storedAttemptText,
  type PipelineDetail,
  type Step,
} from "@/services/file-hook-detail";
import { cleanLabel } from "@/services/file-hook-text";
import { timedOut, type WaitTimes } from "@/services/file-hook-timeouts";

export const FILE_EVENTS = [
  "DocumentFileStoredEvent",
  "DocumentFileReadyToReadEvent",
  "DocumentFilePurgedEvent",
] as const;
export type FileEvent = (typeof FILE_EVENTS)[number];
export function isFileEvent(t: string): t is FileEvent {
  return (FILE_EVENTS as readonly string[]).includes(t);
}
/** Version ids one purge event lists; a document never has this many versions. */
export const MAX_PURGED_VERSION_IDS = 10000;

// ---- Events out ----

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
    versionIds: (v) => Array.isArray(v) && v.length <= MAX_PURGED_VERSION_IDS && v.every(isUuid),
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

/**
 * Whether a stored content hash is the SHA-256 the server computed (lowercase hex). Stored hashes
 * come as `sha256:<hex>` from the screens and as bare hex from the API; anything else never matches.
 */
export function sameContentHash(stored: string | null | undefined, computedHex: string): boolean {
  const m = /^(?:sha256:)?([0-9a-f]{64})$/i.exec(stored ?? "");
  return m !== null && /^[0-9a-f]{64}$/.test(computedHex) && m[1]!.toLowerCase() === computedHex;
}

// ---- Step transitions ----

/** Who handles a step if it starts now, decided by the caller from the organisation switch (D1). */
export type StepOwner = { mode: "simulated" } | { mode: "external"; by: string; byClient: string };
/** A result sent by an outside system: which key sent it, for which version and attempt. */
export interface ResultFrom {
  clientId: string;
  versionId: string;
  attempt: number;
}
export type StepInput =
  | { kind: "confirmed" }
  | { kind: "scanResult"; result: "clean" | "infected" | "error"; from?: ResultFrom }
  | { kind: "readResult"; result: "read" | "unreadable"; from?: ResultFrom }
  | { kind: "timeout" }
  | { kind: "retry" };
export interface StepContext {
  now: string;
  /** The document's current version: the one the step is about. */
  versionId: string;
  owner: Record<Step, StepOwner>;
  /** Needed for `timeout`: the transition checks the wait itself. */
  times?: WaitTimes;
}
export type StepRefusal =
  | "wrongState"
  | "quarantined"
  | "quarantineFull"
  | "notRetryable"
  | "notExternal"
  | "externalPending"
  | "notYourStep"
  | "staleAttempt"
  | "notYet"
  | "noVersion"
  | "badDetail"
  /** The same result from the same system for the same attempt was already applied: answer it again. */
  | "replay";
export type StepOutcome =
  | {
      ok: true;
      state: PipelineState;
      detail: PipelineDetail;
      /**
       * Guard for the write: the state as read, `pipeline_detail->>'attempt'` as stored (null when
       * missing) and the same current version. Two racing inputs cannot both apply (R2.9, R4.3).
       */
      expect: { state: PipelineState; attemptText: string | null; versionId: string };
    }
  | { ok: false; code: StepRefusal };

function start(step: Step, prev: PipelineDetail, ctx: StepContext): PipelineDetail {
  const o = ctx.owner[step];
  return {
    mode: o.mode,
    ...(o.mode === "external"
      ? { by: cleanLabel(o.by, MAX_SYSTEM_NAME_CHARS), byClient: o.byClient }
      : {}),
    since: ctx.now,
    step,
    attempt: Math.min(prev.attempt + 1, MAX_ATTEMPT),
    quarantinedVersions: prev.quarantinedVersions,
  };
}
const STEP_STATE: Record<Step, PipelineState> = { scan: "scanning", read: "reading" };
const refuse = (code: StepRefusal): StepOutcome => ({ ok: false, code });

/** Checks a result against the step it answers: from an outside system only for its own external step. */
function resultRefusal(
  step: Step,
  prev: PipelineDetail,
  from: ResultFrom | undefined,
  versionId: string,
): StepRefusal | null {
  if (!from) return prev.mode === "external" ? "externalPending" : null;
  if (prev.mode !== "external") return "notExternal";
  if (prev.byClient !== from.clientId) return "notYourStep";
  // A late answer about an older version or attempt never applies to the current one.
  return from.attempt === prev.attempt && prev.step === step && from.versionId === versionId
    ? null
    : "staleAttempt";
}

/**
 * The next state and detail of a document's processing, or why the input does not apply. The caller
 * writes the result guarded on `expect`. A quarantined version never moves again (D5).
 */
export function stepTransition(
  state: PipelineState,
  rawDetail: unknown,
  input: StepInput,
  ctx: StepContext,
): StepOutcome {
  const prev = readDetail(rawDetail);
  if (!isUuid(ctx.versionId)) return refuse("noVersion");
  const isResult = input.kind === "scanResult" || input.kind === "readResult";
  if (isResult && input.from) {
    const lr = prev.lastResult;
    const step: Step = input.kind === "scanResult" ? "scan" : "read";
    if (
      lr &&
      lr.step === step &&
      lr.attempt === input.from.attempt &&
      lr.result === input.result &&
      lr.byClient === input.from.clientId
    )
      return refuse("replay");
  }
  const attemptText = storedAttemptText(rawDetail);
  if (attemptText === undefined) return refuse("badDetail");
  const ok = (next: PipelineState, detail: PipelineDetail): StepOutcome => ({
    ok: true,
    state: next,
    detail,
    expect: { state, attemptText, versionId: ctx.versionId },
  });
  if (state === "quarantined" || isQuarantined(prev, ctx.versionId)) return refuse("quarantined");
  const recorded = (step: Step, result: string, from?: ResultFrom) =>
    from ? { lastResult: { step, attempt: from.attempt, result, byClient: from.clientId } } : {};
  switch (input.kind) {
    case "confirmed":
      return state === "uploading"
        ? ok("scanning", start("scan", prev, ctx))
        : refuse("wrongState");
    case "scanResult": {
      if (state !== "scanning") return refuse("wrongState");
      const no = resultRefusal("scan", prev, input.from, ctx.versionId.toLowerCase());
      if (no) return refuse(no);
      const rec = recorded("scan", input.result, input.from);
      if (input.result === "clean") return ok("reading", { ...start("read", prev, ctx), ...rec });
      if (input.result === "error")
        return ok("failed", { ...prev, ...rec, step: "scan", reason: "scanError" });
      // D5: the list is never shortened; a full list is refused (adding versions stops before that).
      if (prev.quarantinedVersions.length >= MAX_QUARANTINED_VERSIONS)
        return refuse("quarantineFull");
      return ok("quarantined", {
        ...prev,
        ...rec,
        step: "scan",
        reason: "threat",
        quarantinedVersions: [...prev.quarantinedVersions, ctx.versionId.toLowerCase()],
      });
    }
    case "readResult": {
      if (state !== "reading") return refuse("wrongState");
      const no = resultRefusal("read", prev, input.from, ctx.versionId.toLowerCase());
      if (no) return refuse(no);
      const rec = recorded("read", input.result, input.from);
      return input.result === "read"
        ? ok("ready", {
            attempt: prev.attempt,
            quarantinedVersions: prev.quarantinedVersions,
            ...rec,
          })
        : ok("failed", { ...prev, ...rec, step: "read", reason: "unreadable" });
    }
    case "timeout": {
      if (state !== "uploading" && state !== "scanning" && state !== "reading")
        return refuse("wrongState");
      // Only a step waiting for an outside system times out; it never becomes clean or ready (R4.7).
      if (state !== "uploading" && prev.mode !== "external") return refuse("notExternal");
      if (!ctx.times || !timedOut(state, rawDetail, ctx.times, ctx.now)) return refuse("notYet");
      if (state === "uploading") return ok("failed", { ...prev, reason: "noFile" });
      return ok("failed", {
        ...prev,
        step: state === "scanning" ? "scan" : "read",
        reason: "noResult",
      });
    }
    case "retry": {
      if (state !== "failed") return refuse("wrongState");
      // A file that never arrived is added again, not retried. Old failures without a step were reading.
      if (prev.reason === "noFile") return refuse("notRetryable");
      const step = prev.step ?? "read";
      return ok(STEP_STATE[step], start(step, prev, ctx));
    }
  }
}
