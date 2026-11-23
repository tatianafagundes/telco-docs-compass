// File hooks, pure rules: event whitelist (R1.5, R1.6) and step transitions (R2.3–R2.9, R3.5,
// R4.2–R4.7, D5).
import { describe, expect, it } from "vitest";
import type { PipelineState } from "@/schemas/document";
import { MAX_QUARANTINED_VERSIONS } from "@/services/file-hook-detail";
import {
  fileEventPayload,
  MAX_PURGED_VERSION_IDS,
  stepTransition,
  type StepContext,
  type StepInput,
} from "@/services/file-hook-rules";
import { EXTERNAL_RESULT_TIMEOUT_MINUTES } from "@/services/file-hook-timeouts";

const V = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-24T10:00:00.000Z";
const LONG_AGO = "2026-11-20T10:00:00.000Z";
const scanOwner = { mode: "external" as const, by: "Acme AV", byClient: "c-scan" };
const readOwner = { mode: "external" as const, by: "Acme OCR", byClient: "c-read" };
const sim = { mode: "simulated" as const };
const ctx = (owner: StepContext["owner"] = { scan: scanOwner, read: sim }): StepContext => ({
  now: NOW,
  versionId: V,
  owner,
  times: { uploadStartedAt: LONG_AGO, updatedAt: LONG_AGO },
});
const extScan = { mode: "external", byClient: "c-scan", step: "scan", attempt: 1 };
const extRead = { mode: "external", byClient: "c-read", step: "read", attempt: 2 };
const fromScan = { clientId: "c-scan", versionId: V, attempt: 1 };
const fromRead = { clientId: "c-read", versionId: V, attempt: 2 };

describe("file event payloads keep only whitelisted keys", () => {
  it("keeps the Stored keys with the right types", () => {
    const p = {
      versionId: V,
      contentHash: "sha256:ab",
      sizeBytes: 12,
      mediaType: "application/pdf",
      attempt: 1,
    };
    expect(fileEventPayload("DocumentFileStoredEvent", p)).toEqual(p);
  });
  it.each([
    ["extra key", { versionId: V, attempt: 1, name: "Report.pdf" }, { versionId: V, attempt: 1 }],
    ["wrong type", { versionId: V, attempt: "1" }, { versionId: V }],
    ["negative attempt", { versionId: V, attempt: -1 }, { versionId: V }],
    ["not a uuid", { versionId: "x", attempt: 2 }, { attempt: 2 }],
    ["null", null, {}],
    ["array", [V], {}],
    ["string", "versionId", {}],
  ])("ReadyToRead with %s", (_n, p, want) => {
    expect(fileEventPayload("DocumentFileReadyToReadEvent", p)).toEqual(want);
  });
  it("never takes inherited or __proto__ keys", () => {
    const p = JSON.parse(`{"__proto__":{"versionId":"${V}"},"attempt":3}`) as unknown;
    const inherited = Object.create({ versionId: V }) as Record<string, unknown>;
    expect(fileEventPayload("DocumentFileReadyToReadEvent", p)).toEqual({ attempt: 3 });
    expect(fileEventPayload("DocumentFileReadyToReadEvent", inherited)).toEqual({});
  });
  it("drops a Stored size the database left null, and a hash or media type with odd characters", () => {
    const out = fileEventPayload("DocumentFileStoredEvent", {
      versionId: V,
      sizeBytes: null,
      contentHash: "<script>",
      mediaType: "text/html; x=<y>",
    });
    expect(out).toEqual({ versionId: V });
  });
  it("Purged keeps a list of version ids only when every entry is one, up to the limit", () => {
    const purged = (ids: unknown) =>
      fileEventPayload("DocumentFilePurgedEvent", { versionIds: ids });
    expect(purged([])).toEqual({ versionIds: [] });
    expect(purged([V, V2])).toEqual({ versionIds: [V, V2] });
    expect(purged([V, "x"])).toEqual({});
    expect(purged(Array(MAX_PURGED_VERSION_IDS).fill(V))["versionIds"]).toHaveLength(
      MAX_PURGED_VERSION_IDS,
    );
    expect(purged(Array(MAX_PURGED_VERSION_IDS + 1).fill(V))).toEqual({});
  });
});

type Row = [string, PipelineState, unknown, StepInput, string, Record<string, unknown>?];
const q = { quarantinedVersions: [V2] };
const qCur = { quarantinedVersions: [V] };
// [case, state, detail, input, next state or refusal code, detail it must contain]
const TABLE: Row[] = [
  // Upload confirmed
  [
    "upload confirmed",
    "uploading",
    null,
    { kind: "confirmed" },
    "scanning",
    { step: "scan", attempt: 1, by: "Acme AV", byClient: "c-scan", since: NOW },
  ],
  [
    "upload confirmed keeps the quarantine list",
    "uploading",
    { attempt: 4, ...q },
    { kind: "confirmed" },
    "scanning",
    { attempt: 5, ...q },
  ],
  ["confirmed twice", "scanning", null, { kind: "confirmed" }, "wrongState"],
  ["confirmed on a failed document", "failed", null, { kind: "confirmed" }, "wrongState"],
  ["confirmed for a quarantined version", "uploading", qCur, { kind: "confirmed" }, "quarantined"],
  // Simulated scan and reading (R4.1, R4.2)
  [
    "simulated clean",
    "scanning",
    { attempt: 1, ...q },
    { kind: "scanResult", result: "clean" },
    "reading",
    { step: "read", attempt: 2, mode: "simulated", ...q },
  ],
  [
    "simulated infected",
    "scanning",
    { attempt: 1, ...q },
    { kind: "scanResult", result: "infected" },
    "quarantined",
    { reason: "threat", step: "scan", attempt: 1, quarantinedVersions: [V2, V] },
  ],
  [
    "simulated advance of an external scan",
    "scanning",
    extScan,
    { kind: "scanResult", result: "clean" },
    "externalPending",
  ],
  [
    "simulated advance of an external read",
    "reading",
    extRead,
    { kind: "readResult", result: "read" },
    "externalPending",
  ],
  [
    "simulated read",
    "reading",
    { attempt: 2, ...q },
    { kind: "readResult", result: "read" },
    "ready",
    q,
  ],
  [
    "simulated unreadable",
    "reading",
    { attempt: 2 },
    { kind: "readResult", result: "unreadable" },
    "failed",
    { reason: "unreadable", step: "read" },
  ],
  // External results (R2.3, R2.4, R3.5)
  [
    "scanner clean",
    "scanning",
    extScan,
    { kind: "scanResult", result: "clean", from: fromScan },
    "reading",
    {
      step: "read",
      attempt: 2,
      lastResult: { step: "scan", attempt: 1, result: "clean", byClient: "c-scan" },
    },
  ],
  [
    "scanner infected",
    "scanning",
    extScan,
    { kind: "scanResult", result: "infected", from: fromScan },
    "quarantined",
    { reason: "threat", quarantinedVersions: [V] },
  ],
  [
    "scanner error",
    "scanning",
    { ...extScan, by: "Acme AV" },
    { kind: "scanResult", result: "error", from: fromScan },
    "failed",
    { reason: "scanError", step: "scan", by: "Acme AV" },
  ],
  [
    "result from another key",
    "scanning",
    extScan,
    { kind: "scanResult", result: "clean", from: { ...fromScan, clientId: "c-other" } },
    "notYourStep",
  ],
  [
    "result for an older attempt",
    "scanning",
    { ...extScan, attempt: 3 },
    { kind: "scanResult", result: "clean", from: fromScan },
    "staleAttempt",
  ],
  [
    "result about an older version",
    "scanning",
    extScan,
    { kind: "scanResult", result: "clean", from: { ...fromScan, versionId: V2 } },
    "staleAttempt",
  ],
  [
    "result for a simulated step",
    "scanning",
    { mode: "simulated", attempt: 1 },
    { kind: "scanResult", result: "clean", from: fromScan },
    "notExternal",
  ],
  [
    "scan result while reading",
    "reading",
    extRead,
    { kind: "scanResult", result: "clean", from: fromScan },
    "wrongState",
  ],
  [
    "reader read",
    "reading",
    extRead,
    { kind: "readResult", result: "read", from: fromRead },
    "ready",
    { attempt: 2, lastResult: { step: "read", result: "read" } },
  ],
  [
    "reader unreadable",
    "reading",
    extRead,
    { kind: "readResult", result: "unreadable", from: fromRead },
    "failed",
    { reason: "unreadable", step: "read" },
  ],
  [
    "read result while scanning",
    "scanning",
    extScan,
    { kind: "readResult", result: "read", from: fromRead },
    "wrongState",
  ],
  [
    "read result after the version was quarantined",
    "reading",
    { ...extRead, ...qCur },
    { kind: "readResult", result: "read", from: fromRead },
    "quarantined",
  ],
  [
    "result on an uploading document",
    "uploading",
    null,
    { kind: "scanResult", result: "clean" },
    "wrongState",
  ],
  [
    "read on an uploading document",
    "uploading",
    null,
    { kind: "readResult", result: "read" },
    "wrongState",
  ],
  // Replays (R2.8): the same result again answers the stored outcome
  [
    "clean sent again",
    "reading",
    { ...extRead, lastResult: { step: "scan", attempt: 1, result: "clean", byClient: "c-scan" } },
    { kind: "scanResult", result: "clean", from: fromScan },
    "replay",
  ],
  [
    "infected sent again",
    "quarantined",
    { ...qCur, lastResult: { step: "scan", attempt: 1, result: "infected", byClient: "c-scan" } },
    { kind: "scanResult", result: "infected", from: fromScan },
    "replay",
  ],
  [
    "a different result after one applied",
    "reading",
    { ...extRead, lastResult: { step: "scan", attempt: 1, result: "clean", byClient: "c-scan" } },
    { kind: "scanResult", result: "infected", from: fromScan },
    "wrongState",
  ],
  [
    "the same result from another key",
    "quarantined",
    { ...qCur, lastResult: { step: "scan", attempt: 1, result: "infected", byClient: "c-scan" } },
    { kind: "scanResult", result: "infected", from: { ...fromScan, clientId: "c-x" } },
    "quarantined",
  ],
  // Timeouts (R4.7)
  [
    "upload never confirmed",
    "uploading",
    null,
    { kind: "timeout" },
    "failed",
    { reason: "noFile" },
  ],
  [
    "external scan with no answer",
    "scanning",
    { ...extScan, since: LONG_AGO },
    { kind: "timeout" },
    "failed",
    { reason: "noResult", step: "scan" },
  ],
  [
    "external read with no answer",
    "reading",
    { ...extRead, since: LONG_AGO },
    { kind: "timeout" },
    "failed",
    { reason: "noResult", step: "read" },
  ],
  [
    "external scan just started",
    "scanning",
    { ...extScan, since: NOW },
    { kind: "timeout" },
    "notYet",
  ],
  ["simulated scan", "scanning", { mode: "simulated" }, { kind: "timeout" }, "notExternal"],
  ["ready", "ready", null, { kind: "timeout" }, "wrongState"],
  ["failed", "failed", null, { kind: "timeout" }, "wrongState"],
  [
    "timeout for a quarantined version",
    "scanning",
    { ...extScan, ...qCur, since: LONG_AGO },
    { kind: "timeout" },
    "quarantined",
  ],
  // Try again (R4.4)
  [
    "retry a scan error",
    "failed",
    { step: "scan", reason: "scanError", attempt: 1 },
    { kind: "retry" },
    "scanning",
    { step: "scan", attempt: 2, byClient: "c-scan" },
  ],
  [
    "retry a scan with no answer",
    "failed",
    { step: "scan", reason: "noResult", attempt: 3 },
    { kind: "retry" },
    "scanning",
    { attempt: 4 },
  ],
  [
    "retry an old scan error with no step",
    "failed",
    { reason: "scanError" },
    { kind: "retry" },
    "scanning",
    { step: "scan" },
  ],
  [
    "retry an old reading failure",
    "failed",
    { reason: "unreadableAgain" },
    { kind: "retry" },
    "reading",
    { step: "read" },
  ],
  ["retry a never-arrived file", "failed", { reason: "noFile" }, { kind: "retry" }, "notRetryable"],
  ["retry something not failed", "ready", null, { kind: "retry" }, "wrongState"],
  ["retry on an uploading document", "uploading", null, { kind: "retry" }, "wrongState"],
  [
    "retry a quarantined document",
    "quarantined",
    { reason: "threat" },
    { kind: "retry" },
    "quarantined",
  ],
  [
    "retry a failed document whose version is quarantined",
    "failed",
    { ...qCur, reason: "scanError", step: "scan" },
    { kind: "retry" },
    "quarantined",
  ],
  [
    "clean on a quarantined document",
    "quarantined",
    null,
    { kind: "scanResult", result: "clean" },
    "quarantined",
  ],
  // Guard values
  [
    "an attempt the database cannot compare",
    "uploading",
    { attempt: { n: 1 } },
    { kind: "confirmed" },
    "badDetail",
  ],
];

describe("stepTransition", () => {
  it.each(TABLE)("%s", (_n, state, detail, input, want, has) => {
    const r = stepTransition(state, detail, input, ctx());
    if (r.ok) {
      expect(r.state).toBe(want);
      if (has) expect(r.detail).toMatchObject(has);
      expect(r.expect.state).toBe(state);
      expect(r.expect.versionId).toBe(V);
    } else expect(r.code).toBe(want);
  });
  it.each([
    ["missing", null, null],
    ["JSON null", { attempt: null }, null],
    ["an integer", { attempt: 3 }, "3"],
  ])("guards on the stored attempt when it is %s", (_n, detail, text) => {
    const r = stepTransition("uploading", detail, { kind: "confirmed" }, ctx());
    expect(r.ok && r.expect.attemptText).toBe(text);
  });
  it("an attempt stored as text is refused, never counted from 0 again", () => {
    expect(stepTransition("uploading", { attempt: "x" }, { kind: "confirmed" }, ctx())).toEqual({
      ok: false,
      code: "badDetail",
    });
  });
  it("records when the step started and drops the old failure reason on retry", () => {
    const r = stepTransition(
      "failed",
      { step: "read", reason: "unreadable", attempt: 2 },
      { kind: "retry" },
      ctx(),
    );
    expect(r.ok && r.detail).toEqual({
      mode: "simulated",
      since: NOW,
      step: "read",
      attempt: 3,
      quarantinedVersions: [],
    });
  });
  it("a retry follows the switch as it is now: external read, or simulated after it was turned off", () => {
    const failedRead = { step: "read", reason: "noResult", mode: "external", byClient: "c-read" };
    const ext = stepTransition(
      "failed",
      failedRead,
      { kind: "retry" },
      ctx({ scan: sim, read: readOwner }),
    );
    expect(ext.ok && ext.detail).toMatchObject({
      mode: "external",
      byClient: "c-read",
      by: "Acme OCR",
    });
    const off = stepTransition(
      "failed",
      failedRead,
      { kind: "retry" },
      ctx({ scan: sim, read: sim }),
    );
    expect(off.ok && off.detail).toEqual({
      mode: "simulated",
      since: NOW,
      step: "read",
      attempt: 1,
      quarantinedVersions: [],
    });
  });
  it("cleans the system name: unsafe characters replaced, cut by code points", () => {
    const by = `\u202E${"😀".repeat(200)}`;
    const r = stepTransition(
      "uploading",
      null,
      { kind: "confirmed" },
      ctx({ scan: { ...scanOwner, by }, read: sim }),
    );
    const name = r.ok ? (r.detail.by ?? "") : "";
    expect(name.startsWith("\uFFFD")).toBe(true);
    expect([...name]).toHaveLength(120);
    expect(name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
  it("never forgets a quarantined version: a full list refuses instead of dropping one", () => {
    const ids = Array.from(
      { length: MAX_QUARANTINED_VERSIONS },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const full = { ...extScan, quarantinedVersions: ids };
    expect(
      stepTransition(
        "scanning",
        full,
        { kind: "scanResult", result: "infected", from: fromScan },
        ctx(),
      ),
    ).toEqual({ ok: false, code: "quarantineFull" });
    const room = { ...extScan, quarantinedVersions: ids.slice(1) };
    const r = stepTransition(
      "scanning",
      room,
      { kind: "scanResult", result: "infected", from: fromScan },
      ctx(),
    );
    expect(r.ok && r.detail.quarantinedVersions).toHaveLength(MAX_QUARANTINED_VERSIONS);
  });
  it("a timeout without the wait times is not applied", () => {
    const { times: _t, ...noTimes } = ctx();
    expect(stepTransition("uploading", null, { kind: "timeout" }, noTimes)).toEqual({
      ok: false,
      code: "notYet",
    });
  });
  it("an external step with no start time waits from the last change", () => {
    const at = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();
    const c = (updatedAt: string) => ({ ...ctx(), times: { uploadStartedAt: NOW, updatedAt } });
    const noSince = { mode: "external", byClient: "c-scan", step: "scan" };
    expect(
      stepTransition(
        "scanning",
        noSince,
        { kind: "timeout" },
        c(at(EXTERNAL_RESULT_TIMEOUT_MINUTES + 1)),
      ).ok,
    ).toBe(true);
    expect(stepTransition("scanning", noSince, { kind: "timeout" }, c(at(1)))).toEqual({
      ok: false,
      code: "notYet",
    });
  });
  it("refuses without a current version", () => {
    expect(
      stepTransition("uploading", null, { kind: "confirmed" }, { ...ctx(), versionId: "" }),
    ).toEqual({ ok: false, code: "noVersion" });
  });
});
