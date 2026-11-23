// File hooks, pure rules: event whitelist (R1.5, R1.6), step transitions (R2.4, R3.5, R4.4, R4.7, D5),
// download rule (R2.1, R3.1, D5) and timeouts (D8).
import { describe, expect, it } from "vitest";
import { downloadDecision } from "@/services/file-hook-download";
import {
  EXTERNAL_RESULT_TIMEOUT_MINUTES,
  fileEventPayload,
  quarantineAlertDue,
  QUARANTINE_ALERT_PER_HOUR,
  readDetail,
  stepTransition,
  timedOut,
  UPLOAD_CONFIRM_TIMEOUT_HOURS,
  type StepContext,
  type StepInput,
} from "@/services/file-hook-rules";
import type { PipelineState } from "@/schemas/document";

const V = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-24T10:00:00.000Z";
const ext = { mode: "external" as const, by: "Acme AV", byClient: "c-scan" };
const sim = { mode: "simulated" as const };
const ctx = (owner: StepContext["owner"] = { scan: ext, read: sim }): StepContext => ({
  now: NOW,
  versionId: V,
  owner,
});

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
  it("Purged keeps a list of version ids only when every entry is one", () => {
    expect(fileEventPayload("DocumentFilePurgedEvent", { versionIds: [] })).toEqual({
      versionIds: [],
    });
    expect(fileEventPayload("DocumentFilePurgedEvent", { versionIds: [V, V2] })).toEqual({
      versionIds: [V, V2],
    });
    expect(fileEventPayload("DocumentFilePurgedEvent", { versionIds: [V, "x"] })).toEqual({});
  });
});

describe("readDetail never throws and drops what it does not know", () => {
  it.each([null, undefined, "x", 3, [], { attempt: "9" }, { attempt: 1.5 }, { attempt: 1e12 }])(
    "%j reads as attempt 0 with no quarantined versions",
    (raw) => {
      expect(readDetail(raw)).toMatchObject({ attempt: 0, quarantinedVersions: [] });
    },
  );
  it("reads the old unreadableAgain reason as a reading failure", () => {
    expect(readDetail({ reason: "unreadableAgain" })).toMatchObject({
      reason: "unreadable",
      step: "read",
    });
  });
  it("keeps only uuids in quarantinedVersions, once each", () => {
    expect(
      readDetail({ quarantinedVersions: [V, V.toUpperCase(), "x", 3] }).quarantinedVersions,
    ).toEqual([V]);
  });
});

type Row = [PipelineState, unknown, StepInput, PipelineState | string, Record<string, unknown>?];
const q = { quarantinedVersions: [V2] };
// [state, detail, input, next state or refusal code, detail it must contain]
const TABLE: Row[] = [
  ["uploading", null, { kind: "confirmed" }, "scanning", { step: "scan", attempt: 1, ...ext }],
  ["uploading", { attempt: 4, ...q }, { kind: "confirmed" }, "scanning", { attempt: 5, ...q }],
  ["scanning", null, { kind: "confirmed" }, "wrongState"],
  [
    "scanning",
    { attempt: 1, ...q },
    { kind: "scanResult", result: "clean" },
    "reading",
    { step: "read", attempt: 2, mode: "simulated", ...q },
  ],
  [
    "scanning",
    { attempt: 1, ...q },
    { kind: "scanResult", result: "infected" },
    "quarantined",
    { reason: "threat", step: "scan", attempt: 1, quarantinedVersions: [V2, V] },
  ],
  [
    "scanning",
    { attempt: 1, ...ext },
    { kind: "scanResult", result: "error" },
    "failed",
    { reason: "scanError", step: "scan", by: "Acme AV" },
  ],
  ["reading", null, { kind: "scanResult", result: "clean" }, "wrongState"],
  ["reading", { attempt: 2, ...q }, { kind: "readResult", result: "read" }, "ready", q],
  [
    "reading",
    { attempt: 2 },
    { kind: "readResult", result: "unreadable" },
    "failed",
    { reason: "unreadable", step: "read" },
  ],
  ["scanning", null, { kind: "readResult", result: "read" }, "wrongState"],
  ["uploading", null, { kind: "timeout" }, "failed", { reason: "noFile" }],
  [
    "scanning",
    { mode: "external", attempt: 1 },
    { kind: "timeout" },
    "failed",
    { reason: "noResult", step: "scan" },
  ],
  [
    "reading",
    { mode: "external", attempt: 2 },
    { kind: "timeout" },
    "failed",
    { reason: "noResult", step: "read" },
  ],
  ["scanning", { mode: "simulated" }, { kind: "timeout" }, "notExternal"],
  ["ready", null, { kind: "timeout" }, "wrongState"],
  [
    "failed",
    { step: "scan", reason: "scanError", attempt: 1 },
    { kind: "retry" },
    "scanning",
    { step: "scan", attempt: 2, ...ext },
  ],
  [
    "failed",
    { step: "scan", reason: "noResult", attempt: 3 },
    { kind: "retry" },
    "scanning",
    { attempt: 4 },
  ],
  ["failed", { reason: "unreadableAgain" }, { kind: "retry" }, "reading", { step: "read" }],
  ["failed", { reason: "noFile" }, { kind: "retry" }, "notRetryable"],
  ["ready", null, { kind: "retry" }, "wrongState"],
  ["quarantined", { reason: "threat" }, { kind: "retry" }, "quarantined"],
  ["quarantined", null, { kind: "scanResult", result: "clean" }, "quarantined"],
  ["uploading", { quarantinedVersions: [V] }, { kind: "confirmed" }, "quarantined"],
];

describe("stepTransition", () => {
  it.each(TABLE)("%s + %j + %j → %s", (state, detail, input, want, has) => {
    const r = stepTransition(state, detail, input, ctx());
    if (r.ok) {
      expect(r.state).toBe(want);
      if (has) expect(r.detail).toMatchObject(has);
      expect(r.expect).toEqual({ state, attempt: readDetail(detail).attempt, versionId: V });
    } else expect(r.code).toBe(want);
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
  it("refuses without a current version", () => {
    expect(
      stepTransition("uploading", null, { kind: "confirmed" }, { ...ctx(), versionId: "" }),
    ).toEqual({
      ok: false,
      code: "noVersion",
    });
  });
});

describe("timeouts", () => {
  const at = (minutesAgo: number) => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();
  const N = EXTERNAL_RESULT_TIMEOUT_MINUTES;
  it.each([
    ["scanning", { mode: "external", since: at(N + 1) }, true],
    ["scanning", { mode: "external", since: at(N) }, false],
    ["reading", { mode: "external", since: at(N + 1) }, true],
    ["scanning", { mode: "simulated", since: at(N * 10) }, false],
    ["scanning", { mode: "external" }, false],
    ["scanning", { mode: "external", since: "not a date" }, false],
    ["ready", { mode: "external", since: at(N * 10) }, false],
  ] as const)("%s %j → %s", (state, detail, want) => {
    expect(timedOut(state, detail, NOW, NOW)).toBe(want);
  });
  it("an upload fails after the confirm window, not before", () => {
    const H = UPLOAD_CONFIRM_TIMEOUT_HOURS * 60;
    expect(timedOut("uploading", null, at(H + 1), NOW)).toBe(true);
    expect(timedOut("uploading", null, at(H), NOW)).toBe(false);
  });
});

describe("download rule", () => {
  const doc = (pipelineState: PipelineState, pipelineDetail: unknown = null) => ({
    pipelineState,
    pipelineDetail,
    currentVersionId: V,
  });
  const scanning = doc("scanning", { mode: "external", byClient: "c-scan" });
  const reading = doc("reading", { mode: "external", byClient: "c-read" });
  const scanner = { kind: "scanner" as const, clientId: "c-scan" };
  const reader = { kind: "reader" as const, clientId: "c-read" };
  it.each([
    ["person, ready", { kind: "person" }, doc("ready"), V, { ok: true, receipt: false }],
    ["read key, ready", { kind: "readKey" }, doc("ready"), V, { ok: true, receipt: false }],
    ["person, scanning", { kind: "person" }, scanning, V, { ok: false, code: "contentLocked" }],
    ["read key, scanning", { kind: "readKey" }, scanning, V, { ok: false, code: "contentLocked" }],
    ["scanner in its step", scanner, scanning, V, { ok: true, receipt: true }],
    ["scanner, older version", scanner, scanning, V2, { ok: false, code: "notYourStep" }],
    [
      "another scanner",
      { kind: "scanner", clientId: "c-other" },
      scanning,
      V,
      { ok: false, code: "notYourStep" },
    ],
    [
      "scanner, simulated step",
      scanner,
      doc("scanning", { mode: "simulated", byClient: "c-scan" }),
      V,
      { ok: false, code: "notYourStep" },
    ],
    ["scanner, reading", scanner, reading, V, { ok: false, code: "notYourStep" }],
    ["scanner, ready", scanner, doc("ready"), V, { ok: false, code: "notYourStep" }],
    ["reader in its step", reader, reading, V, { ok: true, receipt: false }],
    ["reader, scanning", reader, scanning, V, { ok: false, code: "notYourStep" }],
    [
      "person, quarantined current",
      { kind: "person" },
      doc("quarantined"),
      V,
      { ok: false, code: "quarantined" },
    ],
    [
      "person, quarantined older version",
      { kind: "person" },
      doc("ready", { quarantinedVersions: [V2] }),
      V2,
      { ok: false, code: "quarantined" },
    ],
    [
      "scanner, quarantined version even in its step",
      scanner,
      doc("scanning", { mode: "external", byClient: "c-scan", quarantinedVersions: [V] }),
      V,
      { ok: false, code: "quarantined" },
    ],
  ] as const)("%s", (_n, who, d, version, want) => {
    expect(downloadDecision(who, d, version)).toEqual(want);
  });
  it("a scanner key with no client recorded on the step is refused", () => {
    expect(downloadDecision(scanner, doc("scanning", { mode: "external" }), V)).toEqual({
      ok: false,
      code: "notYourStep",
    });
  });
});

describe("quarantine alert", () => {
  it("fires above the limit, not at it", () => {
    expect(quarantineAlertDue(QUARANTINE_ALERT_PER_HOUR)).toBe(false);
    expect(quarantineAlertDue(QUARANTINE_ALERT_PER_HOUR + 1)).toBe(true);
  });
});
