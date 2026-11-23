// File hooks: reading pipeline_detail, the quarantine list carried to new versions (D5), the download
// rule (R2.1, R3.1), timeouts (R4.7, D8) and text from outside systems.
import { describe, expect, it } from "vitest";
import type { PipelineState } from "@/schemas/document";
import {
  carriedQuarantine,
  MAX_QUARANTINED_VERSIONS,
  quarantineHasRoom,
  readDetail,
  storedAttemptText,
} from "@/services/file-hook-detail";
import { downloadDecision } from "@/services/file-hook-download";
import { cleanLabel, codePointSlice, UNSAFE_TEXT } from "@/services/file-hook-text";
import {
  EXTERNAL_RESULT_TIMEOUT_MINUTES,
  quarantineAlertDue,
  QUARANTINE_ALERT_PER_HOUR,
  timedOut,
  UPLOAD_CONFIRM_TIMEOUT_HOURS,
} from "@/services/file-hook-timeouts";

const V = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-24T10:00:00.000Z";

describe("readDetail never throws and drops what it does not know", () => {
  it.each([null, undefined, "x", 3, [], { attempt: "9" }, { attempt: 1.5 }, { attempt: 1e12 }])(
    "%j reads as attempt 0 with no quarantined versions",
    (raw) => expect(readDetail(raw)).toMatchObject({ attempt: 0, quarantinedVersions: [] }),
  );
  it.each([
    [{ reason: "unreadableAgain" }, { reason: "unreadable", step: "read" }],
    [{ reason: "scanError" }, { reason: "scanError", step: "scan" }],
    [{ reason: "threat" }, { reason: "threat", step: "scan" }],
    [{ reason: "noResult" }, { reason: "noResult" }],
    [{ reason: "other" }, {}],
  ])("%j reads its reason and step as %j", (raw, want) => {
    const d = readDetail(raw);
    expect({
      ...(d.reason ? { reason: d.reason } : {}),
      ...(d.step ? { step: d.step } : {}),
    }).toEqual(want);
  });
  it("keeps only uuids in quarantinedVersions, once each, and never shortens the list", () => {
    expect(
      readDetail({ quarantinedVersions: [V, V.toUpperCase(), "x", 3] }).quarantinedVersions,
    ).toEqual([V]);
    const many = Array.from(
      { length: MAX_QUARANTINED_VERSIONS + 5 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(readDetail({ quarantinedVersions: many }).quarantinedVersions).toHaveLength(many.length);
  });
  it("drops a system id that is too long or has odd characters", () => {
    expect(readDetail({ byClient: "c".repeat(65) }).byClient).toBeUndefined();
    expect(readDetail({ byClient: "c x" }).byClient).toBeUndefined();
    expect(readDetail({ byClient: V }).byClient).toBe(V);
  });
  it("reads lastResult only when every part is valid", () => {
    const lr = { step: "scan", attempt: 1, result: "clean", byClient: "c-scan" };
    expect(readDetail({ lastResult: lr }).lastResult).toEqual(lr);
    expect(readDetail({ lastResult: { ...lr, result: "maybe" } }).lastResult).toBeUndefined();
    expect(readDetail({ lastResult: { ...lr, attempt: "1" } }).lastResult).toBeUndefined();
  });
  it("gives the stored attempt as the database reads it, or undefined when it cannot be compared", () => {
    expect(storedAttemptText({})).toBeNull();
    expect(storedAttemptText({ attempt: 7 })).toBe("7");
    // Text, negative and out-of-range attempts read as 0: guarding them would count backwards.
    for (const bad of [true, [1], { n: 1 }, 1.5, "7", "", -1, 1e9])
      expect(storedAttemptText({ attempt: bad })).toBeUndefined();
  });
});

describe("the quarantine list carried to a new version (D5)", () => {
  it("adds the current version of a document quarantined before the list existed", () => {
    expect(carriedQuarantine("quarantined", { reason: "threat" }, V)).toEqual([V]);
    expect(carriedQuarantine("quarantined", { quarantinedVersions: [V] }, V)).toEqual([V]);
    expect(carriedQuarantine("ready", { quarantinedVersions: [V2] }, V)).toEqual([V2]);
    expect(carriedQuarantine("quarantined", null, null)).toEqual([]);
  });
  it("has room for one more version until the limit", () => {
    expect(quarantineHasRoom(Array(MAX_QUARANTINED_VERSIONS - 1).fill(V))).toBe(true);
    expect(quarantineHasRoom(Array(MAX_QUARANTINED_VERSIONS).fill(V))).toBe(false);
  });
});

describe("download rule", () => {
  const doc = (
    pipelineState: PipelineState,
    pipelineDetail: unknown = null,
    currentVersionId: string | null = V,
  ) => ({
    pipelineState,
    pipelineDetail,
    currentVersionId,
  });
  const scanning = doc("scanning", { mode: "external", byClient: "c-scan" });
  const reading = doc("reading", { mode: "external", byClient: "c-read" });
  const scanner = { kind: "scanner" as const, clientId: "c-scan" };
  const reader = { kind: "reader" as const, clientId: "c-read" };
  const no = (code: string) => ({ ok: false, code });
  it.each([
    ["person, ready", { kind: "person" }, doc("ready"), V, { ok: true, receipt: false }],
    ["read key, ready", { kind: "readKey" }, doc("ready"), V, { ok: true, receipt: false }],
    ["person, scanning", { kind: "person" }, scanning, V, no("contentLocked")],
    ["read key, scanning", { kind: "readKey" }, scanning, V, no("contentLocked")],
    ["scanner in its step", scanner, scanning, V, { ok: true, receipt: true }],
    ["scanner, older version", scanner, scanning, V2, no("notYourStep")],
    ["another scanner", { kind: "scanner", clientId: "c-other" }, scanning, V, no("notYourStep")],
    [
      "scanner, simulated step",
      scanner,
      doc("scanning", { mode: "simulated", byClient: "c-scan" }),
      V,
      no("notYourStep"),
    ],
    [
      "scanner, no system recorded",
      scanner,
      doc("scanning", { mode: "external" }),
      V,
      no("notYourStep"),
    ],
    ["scanner, reading", scanner, reading, V, no("notYourStep")],
    ["scanner, ready", scanner, doc("ready"), V, no("notYourStep")],
    [
      "scanner, no current version",
      scanner,
      doc("scanning", { mode: "external", byClient: "c-scan" }, null),
      V,
      no("notYourStep"),
    ],
    ["reader in its step", reader, reading, V, { ok: true, receipt: false }],
    ["reader, scanning", reader, scanning, V, no("notYourStep")],
    ["person, quarantined current", { kind: "person" }, doc("quarantined"), V, no("quarantined")],
    [
      "person, quarantined older version",
      { kind: "person" },
      doc("ready", { quarantinedVersions: [V2] }),
      V2,
      no("quarantined"),
    ],
    [
      "scanner, quarantined version even in its step",
      scanner,
      doc("scanning", { mode: "external", byClient: "c-scan", quarantinedVersions: [V] }),
      V,
      no("quarantined"),
    ],
  ] as const)("%s", (_n, who, d, version, want) => {
    expect(downloadDecision(who, d, version)).toEqual(want);
  });
});

describe("timeouts", () => {
  const at = (minutesAgo: number) => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();
  const N = EXTERNAL_RESULT_TIMEOUT_MINUTES;
  const t = (updatedAt = NOW, uploadStartedAt = NOW) => ({ updatedAt, uploadStartedAt });
  it.each([
    ["scanning", { mode: "external", since: at(N + 1) }, t(), true],
    ["scanning", { mode: "external", since: at(N) }, t(), false],
    ["reading", { mode: "external", since: at(N + 1) }, t(), true],
    ["scanning", { mode: "simulated", since: at(N * 10) }, t(), false],
    ["scanning", { mode: "external" }, t(at(N + 1)), true],
    ["scanning", { mode: "external", since: "not a date" }, t(at(N + 1)), true],
    ["scanning", { mode: "external" }, t("not a date"), false],
    ["ready", { mode: "external", since: at(N * 10) }, t(), false],
  ] as const)("%s %j → %s", (state, detail, times, want) => {
    expect(timedOut(state, detail, times, NOW)).toBe(want);
  });
  it("an upload fails after the confirm window, not before", () => {
    const H = UPLOAD_CONFIRM_TIMEOUT_HOURS * 60;
    expect(timedOut("uploading", null, t(NOW, at(H + 1)), NOW)).toBe(true);
    expect(timedOut("uploading", null, t(NOW, at(H)), NOW)).toBe(false);
  });
  it("the quarantine alert fires above the limit, not at it", () => {
    expect(quarantineAlertDue(QUARANTINE_ALERT_PER_HOUR)).toBe(false);
    expect(quarantineAlertDue(QUARANTINE_ALERT_PER_HOUR + 1)).toBe(true);
  });
});

describe("text from outside systems", () => {
  it.each([
    ["lone high surrogate", "a\uD800b"],
    ["lone low surrogate", "a\uDC00b"],
    ["line separator", "a\u2028b"],
    ["paragraph separator", "a\u2029b"],
    ["zero-width space", "a\u200Bb"],
    ["word joiner", "a\u2060b"],
    ["byte-order mark", "a\uFEFFb"],
    ["tag character", "a\u{E0041}b"],
    ["bidi override", "a\u202Eb"],
    ["control", "a\u0000b"],
  ])("refuses a %s", (_n, s) => expect(UNSAFE_TEXT.test(s)).toBe(true));
  it.each([
    ["emoji", "😀"],
    ["zero-width joiner in an emoji", "👩\u200D💻"],
    ["zero-width non-joiner (Persian)", "می\u200Cخواهم"],
    ["accents", "Ångström Société"],
  ])("accepts %s", (_n, s) => expect(UNSAFE_TEXT.test(s)).toBe(false));
  it("cuts by code points and marks a shortened label", () => {
    expect(codePointSlice("😀😀😀", 2)).toBe("😀😀");
    expect(cleanLabel("😀".repeat(10), 5)).toBe("😀😀😀😀…");
    expect(cleanLabel("a\u202Eb", 10)).toBe("a\uFFFDb");
  });
});
