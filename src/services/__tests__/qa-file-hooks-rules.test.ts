// QA adversarial pass on the pure file-hook rules (phases 1-2 of the file-hooks spec).
// `it.fails` marks a test that asserts the CORRECT behaviour and is expected to fail today: each one
// names the defect. When the defect is fixed the test starts passing and vitest reports it, so the
// marker must then be removed.
import { describe, expect, it } from "vitest";
import {
  carriedQuarantine,
  MAX_ATTEMPT,
  MAX_QUARANTINED_VERSIONS,
  readDetail,
  storedAttemptText,
  type Step,
} from "@/services/file-hook-detail";
import { downloadDecision, type Downloader } from "@/services/file-hook-download";
import {
  bandFor,
  checkExtractedFields,
  extractionResultSchema,
  MAX_EXTRACTED_FIELDS,
  MAX_EXTRACTED_VALUE_CHARS,
  scanResultSchema,
  type ExtractedField,
  type FieldSpec,
} from "@/services/file-hook-fields";
import {
  fileEventPayload,
  MAX_PURGED_VERSION_IDS,
  sameContentHash,
  stepTransition,
  type StepContext,
  type StepInput,
  type StepOwner,
} from "@/services/file-hook-rules";
import { cleanLabel, codePointSlice, UNSAFE_TEXT } from "@/services/file-hook-text";
import { timedOut } from "@/services/file-hook-timeouts";
import { versionStart } from "@/services/file-hook-versions";
import { eventMatches } from "@/services/tmf667-events";
import type { PipelineState } from "@/schemas/document";

const V = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const VA = "abcdefab-abcd-4abc-8abc-abcdefabcdef"; // has letters: case matters
const NOW = "2026-11-24T10:00:00.000Z";
const SIM: Record<Step, StepOwner> = { scan: { mode: "simulated" }, read: { mode: "simulated" } };
const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  now: NOW,
  versionId: V,
  owner: SIM,
  ...over,
});
const ext = (over: Record<string, unknown> = {}) => ({
  mode: "external",
  by: "AV",
  byClient: "c1",
  since: NOW,
  step: "scan",
  attempt: 1,
  quarantinedVersions: [],
  ...over,
});
const minutes = (n: number) => new Date(Date.parse(NOW) - n * 60_000).toISOString();

// ---------------------------------------------------------------------------------------------
describe("QA stepTransition: the whole state x input matrix", () => {
  const STATES: PipelineState[] = [
    "uploading",
    "scanning",
    "reading",
    "ready",
    "failed",
    "quarantined",
  ];
  const INPUTS: Record<string, StepInput> = {
    confirmed: { kind: "confirmed" },
    scanClean: { kind: "scanResult", result: "clean" },
    scanInfected: { kind: "scanResult", result: "infected" },
    scanError: { kind: "scanResult", result: "error" },
    readRead: { kind: "readResult", result: "read" },
    readUnreadable: { kind: "readResult", result: "unreadable" },
    timeout: { kind: "timeout" },
    retry: { kind: "retry" },
  };
  // Simulated step, detail present and readable, a failed read to retry, no wait elapsed.
  const ALLOWED: Record<string, string[]> = {
    uploading: ["confirmed"],
    scanning: ["scanClean", "scanInfected", "scanError"],
    reading: ["readRead", "readUnreadable"],
    failed: ["retry"],
    ready: [],
    quarantined: [],
  };
  const detail = (s: PipelineState) =>
    s === "failed"
      ? { attempt: 2, step: "read", reason: "unreadable", mode: "simulated" }
      : { attempt: 1, mode: "simulated" };
  for (const s of STATES)
    for (const [name, input] of Object.entries(INPUTS))
      it(`${s} + ${name} is ${ALLOWED[s]!.includes(name) ? "applied" : "refused"}`, () => {
        const r = stepTransition(s, detail(s), input, ctx());
        expect(r.ok).toBe(ALLOWED[s]!.includes(name));
      });
  it("an unknown state (a row from a newer or hand-edited database) refuses every input", () => {
    for (const input of Object.values(INPUTS))
      expect(stepTransition("bogus" as PipelineState, {}, input, ctx()).ok).toBe(false);
  });
  it("a version on the quarantine list refuses every input in every state, whatever the state says", () => {
    for (const s of STATES)
      for (const input of Object.values(INPUTS)) {
        const r = stepTransition(s, { attempt: 1, quarantinedVersions: [V] }, input, ctx());
        expect(r, `${s}/${input.kind}`).toMatchObject({ ok: false, code: "quarantined" });
      }
  });
  it("an uppercase current-version id is still caught by a lowercase quarantine entry", () => {
    const r = stepTransition(
      "scanning",
      { attempt: 1, quarantinedVersions: [V] },
      INPUTS["scanClean"]!,
      ctx({ versionId: V.toUpperCase() }),
    );
    expect(r).toMatchObject({ ok: false, code: "quarantined" });
  });
  it("a non-uuid version id is refused before anything else", () => {
    const r = stepTransition("uploading", {}, INPUTS["confirmed"]!, ctx({ versionId: "v1" }));
    expect(r).toMatchObject({ ok: false, code: "noVersion" });
  });
});

describe("QA stepTransition: external results", () => {
  const scanFrom = (over: Record<string, unknown> = {}) =>
    ({
      kind: "scanResult",
      result: "clean",
      from: { clientId: "c1", versionId: V, attempt: 1, ...over },
    }) as StepInput;
  // DEFECT (low, file-hook-rules.ts:201/153): `ctx.versionId` is lowercased before the comparison, but
  // `from.versionId` is not. A scanner that echoes the version id in uppercase (valid per isUuid, and
  // Postgres prints lowercase but clients may not) gets a false `staleAttempt` and its result is dropped.
  it.fails("accepts a result whose version id differs only in case (BUG: staleAttempt)", () => {
    const r = stepTransition(
      "scanning",
      ext(),
      scanFrom({ versionId: VA.toUpperCase() }),
      ctx({ versionId: VA }),
    );
    expect(r.ok).toBe(true);
  });
  it("refuses a result about another version, another attempt, another step, another key", () => {
    const code = (i: StepInput, d = ext()) => {
      const r = stepTransition("scanning", d, i, ctx());
      return r.ok ? "ok" : r.code;
    };
    expect(code(scanFrom({ versionId: V2 }))).toBe("staleAttempt");
    expect(code(scanFrom({ attempt: 0 }))).toBe("staleAttempt");
    expect(code(scanFrom({ attempt: 2 }))).toBe("staleAttempt");
    expect(code(scanFrom({ clientId: "c2" }))).toBe("notYourStep");
    expect(code(scanFrom(), ext({ step: "read" }))).toBe("staleAttempt");
    expect(code(scanFrom(), ext({ mode: "simulated" }))).toBe("notExternal");
    expect(code({ kind: "scanResult", result: "clean" })).toBe("externalPending");
  });
  it("answers an applied result again (replay), including infected and error, ahead of the quarantine refusal", () => {
    for (const result of ["clean", "infected", "error"] as const) {
      const first = stepTransition(
        "scanning",
        ext(),
        { ...scanFrom(), result } as StepInput,
        ctx(),
      );
      expect(first.ok, result).toBe(true);
      if (!first.ok) continue;
      const again = stepTransition(
        first.state,
        first.detail,
        { ...scanFrom(), result } as StepInput,
        ctx(),
      );
      expect(again, result).toMatchObject({ ok: false, code: "replay" });
    }
  });
  it("a replay from another key, or of another result, is not a replay", () => {
    const first = stepTransition("scanning", ext(), scanFrom(), ctx());
    if (!first.ok) throw new Error("setup");
    const other = stepTransition(first.state, first.detail, scanFrom({ clientId: "c2" }), ctx());
    expect(other).toMatchObject({ ok: false });
    expect(other.ok === false && other.code).not.toBe("replay");
  });
  it("after Try again the old attempt's reply is stale, never a replay", () => {
    const failed = stepTransition(
      "scanning",
      ext(),
      { ...scanFrom(), result: "error" } as StepInput,
      ctx(),
    );
    if (!failed.ok) throw new Error("setup");
    const retried = stepTransition(failed.state, failed.detail, { kind: "retry" }, ctx());
    if (!retried.ok) throw new Error("setup");
    expect(retried.detail.attempt).toBe(2);
    expect(retried.detail.lastResult).toBeUndefined();
    const late = stepTransition(
      retried.state,
      retried.detail,
      { ...scanFrom(), result: "error" } as StepInput,
      ctx(),
    );
    // simulated owners after retry: a result from a key is not external at all
    expect(late).toMatchObject({ ok: false });
  });
  it("a read result from the reader never applies to a scanning document", () => {
    const r = stepTransition(
      "scanning",
      ext(),
      { kind: "readResult", result: "read", from: { clientId: "c1", versionId: V, attempt: 1 } },
      ctx(),
    );
    expect(r).toMatchObject({ ok: false, code: "wrongState" });
  });
  it("records which key answered, and never lets a clean result skip the read step's own start", () => {
    const r = stepTransition("scanning", ext(), scanFrom(), ctx());
    expect(r).toMatchObject({
      ok: true,
      state: "reading",
      detail: {
        attempt: 2,
        step: "read",
        lastResult: { step: "scan", attempt: 1, result: "clean", byClient: "c1" },
      },
    });
  });
});

describe("QA stepTransition: boundaries", () => {
  it("quarantine list: 999 entries still take one more, 1000 refuses, and the list never shrinks", () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const input: StepInput = { kind: "scanResult", result: "infected" };
    const ok = stepTransition(
      "scanning",
      { attempt: 1, quarantinedVersions: ids(MAX_QUARANTINED_VERSIONS - 1) },
      input,
      ctx(),
    );
    expect(ok.ok && ok.detail.quarantinedVersions.length).toBe(MAX_QUARANTINED_VERSIONS);
    const full = stepTransition(
      "scanning",
      { attempt: 1, quarantinedVersions: ids(MAX_QUARANTINED_VERSIONS) },
      input,
      ctx(),
    );
    expect(full).toMatchObject({ ok: false, code: "quarantineFull" });
  });
  // DEFECT (low, file-hook-rules.ts:135): at MAX_ATTEMPT `start` keeps the same number, so Try again
  // does not start a new attempt and a late answer of the previous one matches the new step. Needs
  // 999,999,999 retries, so unreachable by people; the invariant "a start always changes the attempt"
  // is what the replay and stale checks rely on.
  it.fails(
    "Try again at MAX_ATTEMPT must still start a different attempt (BUG: same number)",
    () => {
      const r = stepTransition(
        "failed",
        { attempt: MAX_ATTEMPT, step: "read", reason: "unreadable" },
        { kind: "retry" },
        ctx(),
      );
      expect(r.ok && r.detail.attempt).not.toBe(MAX_ATTEMPT);
    },
  );
  it("an unguardable attempt (fraction, boolean, array, object) is refused, not written unguarded; missing counts up from 0", () => {
    for (const attempt of [1.5, true, [1], { a: 1 }])
      expect(
        stepTransition("uploading", { attempt }, { kind: "confirmed" }, ctx()),
        String(attempt),
      ).toMatchObject({
        ok: false,
        code: "badDetail",
      });
    const r = stepTransition("uploading", {}, { kind: "confirmed" }, ctx());
    expect(r.ok && r.detail.attempt).toBe(1);
  });
  // DEFECT (low, file-hook-rules.ts:135 + file-hook-detail.ts:69): a stored attempt that is a JSON
  // string ("5"), or beyond MAX, is guardable (storedAttemptText answers) but reads as 0, so the next
  // start writes attempt 1: the counter goes BACKWARDS from 5 to 1 and an old attempt-1 answer matches
  // again. Reachable only by a hand-edited row; the safe answer is to refuse (badDetail) or keep counting.
  it.fails(
    "never moves the attempt backwards when the stored attempt is the text '5' (BUG: 5 -> 1)",
    () => {
      const r = stepTransition("uploading", { attempt: "5" }, { kind: "confirmed" }, ctx());
      expect(!r.ok || r.detail.attempt > 5).toBe(true);
    },
  );
  it("a document whose attempt cannot be guarded can never move again, even by a new version (pinned dead end)", () => {
    for (const attempt of [true, 1.5, [3], { a: 1 }, 2 ** 53]) {
      expect(
        stepTransition("failed", { attempt, step: "read" }, { kind: "retry" }, ctx()),
      ).toMatchObject({
        ok: false,
        code: "badDetail",
      });
      expect(versionStart("failed", { attempt }, V, undefined)).toMatchObject({
        ok: false,
        code: "badDetail",
      });
    }
  });
  it("timeout needs `times`, an external step, and an elapsed wait", () => {
    const times = { uploadStartedAt: minutes(5), updatedAt: minutes(1) };
    const t = (state: PipelineState, d: unknown, c = ctx({ times })) =>
      stepTransition(state, d, { kind: "timeout" }, c);
    expect(t("scanning", ext({ since: minutes(31) }), ctx())).toMatchObject({
      ok: false,
      code: "notYet",
    });
    expect(t("scanning", ext({ since: minutes(31), mode: "simulated" }))).toMatchObject({
      ok: false,
      code: "notExternal",
    });
    expect(t("scanning", ext({ since: minutes(30) }))).toMatchObject({ ok: false, code: "notYet" });
    expect(t("scanning", ext({ since: minutes(31) }))).toMatchObject({
      ok: true,
      state: "failed",
      detail: { reason: "noResult", step: "scan" },
    });
    expect(t("reading", ext({ since: minutes(31), step: "read" }))).toMatchObject({
      ok: true,
      detail: { reason: "noResult", step: "read" },
    });
    for (const s of ["ready", "failed"] as const)
      expect(t(s, ext({ since: minutes(999) }))).toMatchObject({ ok: false, code: "wrongState" });
    expect(t("quarantined", ext({ since: minutes(999) }))).toMatchObject({ ok: false });
  });
  it("a timed-out step can be retried but a timed-out upload cannot (add the file again)", () => {
    const times = { uploadStartedAt: minutes(24 * 60 + 1), updatedAt: minutes(1) };
    const up = stepTransition("uploading", {}, { kind: "timeout" }, ctx({ times }));
    expect(up).toMatchObject({ ok: true, state: "failed", detail: { reason: "noFile" } });
    if (!up.ok) return;
    expect(stepTransition("failed", up.detail, { kind: "retry" }, ctx())).toMatchObject({
      ok: false,
      code: "notRetryable",
    });
  });
  it("Try again after a timed-out external scan starts the SCAN again, under the owner decided now", () => {
    const owner: Record<Step, StepOwner> = {
      scan: { mode: "external", by: "Other AV", byClient: "c9" },
      read: { mode: "simulated" },
    };
    const r = stepTransition(
      "failed",
      ext({ step: "scan", reason: "noResult", attempt: 4 }),
      { kind: "retry" },
      ctx({ owner }),
    );
    expect(r).toMatchObject({
      ok: true,
      state: "scanning",
      detail: { mode: "external", by: "Other AV", byClient: "c9", attempt: 5, step: "scan" },
    });
  });
  it("a system name from an owner is cleaned and cut by code points", () => {
    const by = `Evil\u202E${"😀".repeat(200)}`;
    const r = stepTransition(
      "uploading",
      {},
      { kind: "confirmed" },
      ctx({ owner: { ...SIM, scan: { mode: "external", by, byClient: "c1" } } }),
    );
    if (!r.ok) throw new Error("setup");
    expect(r.detail.by).not.toContain("\u202E");
    expect([...(r.detail.by ?? "")].length).toBe(120);
    expect(r.detail.by?.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA readDetail / storedAttemptText: jsonb text-guard edge cases", () => {
  const cases: [string, unknown, number, string | null | undefined][] = [
    ["missing", undefined, 0, null],
    ["json null", null, 0, null],
    ["integer", 3, 3, "3"],
    ["zero", 0, 0, "0"],
    ["max", MAX_ATTEMPT, MAX_ATTEMPT, String(MAX_ATTEMPT)],
    ["max+1", MAX_ATTEMPT + 1, 0, "1000000000"],
    ["negative", -3, 0, "-3"],
    ["negative zero", -0, 0, "0"],
    ["text '03'", "03", 0, "03"],
    ["text '3'", "3", 0, "3"],
    ["empty text", "", 0, ""],
    ["fraction", 3.5, 0, undefined],
    ["boolean", true, 0, undefined],
    ["array", [3], 0, undefined],
    ["object", { n: 3 }, 0, undefined],
    ["beyond safe integer", 2 ** 53, 0, undefined],
    ["1e21", 1e21, 0, undefined],
  ];
  for (const [name, attempt, read, text] of cases)
    it(`attempt ${name}: reads as ${read}, guard text ${JSON.stringify(text)}`, () => {
      const raw = attempt === undefined ? {} : { attempt };
      expect(readDetail(raw).attempt + 0).toBe(read);
      expect(storedAttemptText(raw)).toBe(text);
    });
  it("a raw detail that is not an object has attempt 0 and a null guard", () => {
    for (const raw of [null, undefined, "x", 5, [], [{ attempt: 3 }], true])
      expect([readDetail(raw).attempt, storedAttemptText(raw)]).toEqual([0, null]);
  });
  it("inherited and __proto__ keys are never read", () => {
    const inherited = Object.create({ attempt: 9, quarantinedVersions: [V] });
    expect(readDetail(inherited)).toMatchObject({ attempt: 0, quarantinedVersions: [] });
    expect(storedAttemptText(inherited)).toBeNull();
    const parsed = JSON.parse('{"__proto__":{"attempt":9},"attempt":2}');
    expect(readDetail(parsed).attempt).toBe(2);
    expect(({} as Record<string, unknown>)["attempt"]).toBeUndefined();
  });
  it("quarantine list: lower-cased, de-duplicated, junk dropped", () => {
    const d = readDetail({ quarantinedVersions: [V.toUpperCase(), V, "nope", 7, null, V2] });
    expect(d.quarantinedVersions).toEqual([V, V2]);
  });
  it("legacy unreadableAgain reads as unreadable on the read step; reasons give the step", () => {
    expect(readDetail({ reason: "unreadableAgain" })).toMatchObject({
      reason: "unreadable",
      step: "read",
    });
    expect(readDetail({ reason: "threat" }).step).toBe("scan");
    expect(readDetail({ reason: "scanError" }).step).toBe("scan");
    expect(readDetail({ reason: "noResult" }).step).toBeUndefined();
    expect(readDetail({ reason: "mystery" }).reason).toBeUndefined();
  });
  it("lastResult needs every part valid", () => {
    const good = { step: "scan", attempt: 1, result: "clean", byClient: "c1" };
    expect(readDetail({ lastResult: good }).lastResult).toEqual(good);
    for (const bad of [
      { ...good, step: "x" },
      { ...good, attempt: -1 },
      { ...good, result: "maybe" },
      { ...good, byClient: "a b" },
      { ...good, byClient: "x".repeat(65) },
    ])
      expect(readDetail({ lastResult: bad }).lastResult).toBeUndefined();
  });
  it("since keeps offsets and date-only text; garbage is dropped", () => {
    expect(readDetail({ since: "2026-11-24T10:00:00+05:30" }).since).toBeDefined();
    expect(readDetail({ since: "2026-11-24" }).since).toBeDefined();
    expect(readDetail({ since: "not a date" }).since).toBeUndefined();
    expect(readDetail({ since: 1764000000000 }).since).toBeUndefined();
  });
  it("carriedQuarantine adds a legacy quarantined current version once, any case, and only if a uuid", () => {
    expect(carriedQuarantine("quarantined", {}, V.toUpperCase())).toEqual([V]);
    expect(carriedQuarantine("quarantined", { quarantinedVersions: [V] }, V)).toEqual([V]);
    expect(carriedQuarantine("quarantined", {}, null)).toEqual([]);
    expect(carriedQuarantine("quarantined", {}, "not-a-uuid")).toEqual([]);
    expect(carriedQuarantine("ready", {}, V)).toEqual([]);
  });
  it("a new version of a quarantined document whose list is one short of full is refused (the list is never shortened)", () => {
    const ids = Array.from(
      { length: MAX_QUARANTINED_VERSIONS - 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(versionStart("quarantined", { quarantinedVersions: ids }, V)).toMatchObject({
      ok: false,
      code: "quarantineFull",
    });
    expect(versionStart("ready", { quarantinedVersions: ids }, V)).toMatchObject({ ok: true });
  });
  it("restoring a quarantined version is refused in any letter case, and another version is not", () => {
    expect(versionStart("ready", { quarantinedVersions: [V] }, V2, V.toUpperCase())).toMatchObject({
      ok: false,
      code: "quarantined",
    });
    expect(versionStart("ready", { quarantinedVersions: [V] }, V2, V2)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA timeouts", () => {
  const times = { uploadStartedAt: NOW, updatedAt: NOW };
  const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
  it("external wait: not at exactly 30 minutes, yes one millisecond later", () => {
    const d = ext({ since: NOW });
    expect(timedOut("scanning", d, times, at(30 * 60_000))).toBe(false);
    expect(timedOut("scanning", d, times, at(30 * 60_000 + 1))).toBe(true);
    expect(timedOut("reading", ext({ step: "read" }), times, at(30 * 60_000 + 1))).toBe(true);
  });
  it("upload wait: not at exactly 24 hours, yes one millisecond later", () => {
    expect(timedOut("uploading", {}, times, at(24 * 3_600_000))).toBe(false);
    expect(timedOut("uploading", {}, times, at(24 * 3_600_000 + 1))).toBe(true);
  });
  it("a simulated step, and states that are not waiting, never time out", () => {
    const sim = { mode: "simulated", since: NOW, attempt: 1 };
    expect(timedOut("scanning", sim, times, at(1e12))).toBe(false);
    expect(timedOut("scanning", {}, times, at(1e12))).toBe(false);
    for (const s of ["ready", "failed", "quarantined"] as const)
      expect(timedOut(s, ext(), times, at(1e12))).toBe(false);
  });
  it("an external step with unreadable since counts from the document's last change", () => {
    const late = at(31 * 60_000);
    expect(timedOut("scanning", ext({ since: "garbage" }), times, late)).toBe(true);
    expect(timedOut("scanning", ext({ since: undefined }), times, late)).toBe(true);
    expect(timedOut("scanning", ext({ since: "garbage" }), times, at(29 * 60_000))).toBe(false);
  });
  it("an unreadable `now` or upload time is never a timeout", () => {
    expect(timedOut("scanning", ext(), times, "garbage")).toBe(false);
    expect(timedOut("uploading", {}, { ...times, uploadStartedAt: "garbage" }, at(1e12))).toBe(
      false,
    );
  });
  it("a start time in another time zone is compared as an instant", () => {
    const since = "2026-11-24T15:30:00+05:30"; // = 10:00:00Z
    expect(timedOut("scanning", ext({ since }), times, at(30 * 60_000 + 1))).toBe(true);
    expect(timedOut("scanning", ext({ since }), times, at(29 * 60_000))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA downloadDecision matrix", () => {
  const doc = (state: PipelineState, detail: unknown, cur: string | null = V) => ({
    pipelineState: state,
    pipelineDetail: detail,
    currentVersionId: cur,
  });
  const who = {
    person: { kind: "person" },
    readKey: { kind: "readKey" },
    scanner: { kind: "scanner", clientId: "c1" },
    reader: { kind: "reader", clientId: "c1" },
  } as const satisfies Record<string, Downloader>;
  it("nobody downloads a listed version, in any state, with any key, in any letter case", () => {
    for (const s of ["uploading", "scanning", "reading", "ready", "failed", "quarantined"] as const)
      for (const w of Object.values(who))
        expect(
          downloadDecision(w, doc(s, ext({ quarantinedVersions: [V] })), V.toUpperCase()),
          `${s}/${w.kind}`,
        ).toEqual({ ok: false, code: "quarantined" });
  });
  it("the current version of a quarantined document is blocked even when the list is missing (legacy rows)", () => {
    for (const w of Object.values(who))
      expect(downloadDecision(w, doc("quarantined", {}), V)).toEqual({
        ok: false,
        code: "quarantined",
      });
  });
  it("an older version of a quarantined document is still locked for people", () => {
    expect(downloadDecision(who.person, doc("quarantined", {}), V2)).toEqual({
      ok: false,
      code: "contentLocked",
    });
  });
  it("a scanner gets the current version only while its own external scan runs, and a receipt", () => {
    expect(downloadDecision(who.scanner, doc("scanning", ext()), V)).toEqual({
      ok: true,
      receipt: true,
    });
    const no = (
      s: PipelineState,
      d: unknown,
      w: Downloader = who.scanner,
      v = V,
      cur: string | null = V,
    ) => downloadDecision(w, doc(s, d, cur), v);
    expect(no("scanning", ext(), who.scanner, V2)).toMatchObject({
      ok: false,
      code: "notYourStep",
    });
    expect(no("scanning", ext(), who.scanner, V, null)).toMatchObject({ ok: false });
    expect(no("scanning", ext({ byClient: "c2" }))).toMatchObject({
      ok: false,
      code: "notYourStep",
    });
    expect(no("scanning", ext({ mode: "simulated" }))).toMatchObject({ ok: false });
    expect(
      no("scanning", ext({ byClient: undefined }), { kind: "scanner", clientId: "" }),
    ).toMatchObject({ ok: false });
    expect(no("reading", ext())).toMatchObject({ ok: false });
    expect(no("uploading", ext())).toMatchObject({ ok: false });
    expect(no("failed", ext())).toMatchObject({ ok: false });
    expect(no("scanning", ext(), who.reader)).toMatchObject({ ok: false });
  });
  it("a reader gets the current version only while its own external read runs, with no receipt", () => {
    expect(downloadDecision(who.reader, doc("reading", ext({ step: "read" })), V)).toEqual({
      ok: true,
      receipt: false,
    });
    expect(downloadDecision(who.reader, doc("scanning", ext()), V)).toMatchObject({ ok: false });
  });
  it("people and read keys: locked while scanning or quarantined, open otherwise", () => {
    for (const w of [who.person, who.readKey]) {
      expect(downloadDecision(w, doc("scanning", {}), V)).toMatchObject({ code: "contentLocked" });
      expect(downloadDecision(w, doc("ready", {}), V)).toEqual({ ok: true, receipt: false });
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA file-event whitelist", () => {
  it("drops every key not listed, and never reads inherited or __proto__ keys", () => {
    const evil = JSON.parse(
      `{"versionId":"${V}","attempt":1,"__proto__":{"versionId":"${V2}"},"constructor":"x","name":"Secret.pdf","description":"d","reason":"hold"}`,
    );
    expect(fileEventPayload("DocumentFileReadyToReadEvent", evil)).toEqual({
      versionId: V,
      attempt: 1,
    });
    expect(
      fileEventPayload("DocumentFileReadyToReadEvent", Object.create({ versionId: V })),
    ).toEqual({});
  });
  it("a key from another event's list is not carried (type confusion)", () => {
    const stored = {
      versionId: V,
      contentHash: "sha256:ab",
      sizeBytes: 1,
      mediaType: "a/b",
      attempt: 1,
    };
    expect(fileEventPayload("DocumentFileReadyToReadEvent", stored)).toEqual({
      versionId: V,
      attempt: 1,
    });
    expect(fileEventPayload("DocumentFilePurgedEvent", stored)).toEqual({});
  });
  it("wrong types are left out one by one", () => {
    const p = fileEventPayload("DocumentFileStoredEvent", {
      versionId: 5,
      contentHash: ["x"],
      sizeBytes: "12",
      mediaType: { a: 1 },
      attempt: "1",
    });
    expect(p).toEqual({});
  });
  it("payloads that are not plain objects give nothing", () => {
    for (const p of [null, undefined, "x", 3, [], [V]])
      expect(fileEventPayload("DocumentFileStoredEvent", p)).toEqual({});
  });
  it("boundary values: size, attempt, hash length, media type", () => {
    const f = (o: Record<string, unknown>) => fileEventPayload("DocumentFileStoredEvent", o);
    expect(f({ sizeBytes: 0 })).toEqual({ sizeBytes: 0 });
    expect(f({ sizeBytes: Number.MAX_SAFE_INTEGER })).toEqual({
      sizeBytes: Number.MAX_SAFE_INTEGER,
    });
    for (const bad of [-1, 1.5, 2 ** 53, NaN, Infinity]) expect(f({ sizeBytes: bad })).toEqual({});
    expect(f({ attempt: 0 })).toEqual({ attempt: 0 });
    expect(f({ attempt: MAX_ATTEMPT })).toEqual({ attempt: MAX_ATTEMPT });
    for (const bad of [-1, MAX_ATTEMPT + 1, 0.5]) expect(f({ attempt: bad })).toEqual({});
    expect(f({ contentHash: "a".repeat(200) })).toEqual({ contentHash: "a".repeat(200) });
    for (const bad of ["", "a".repeat(201), "sha256: ab", "ab\n", "sha256:ab\u202E"])
      expect(f({ contentHash: bad }), JSON.stringify(bad)).toEqual({});
    for (const bad of [
      "text/plain\n",
      "a/b/c",
      "textplain",
      "/x",
      "x/",
      "text/plain; charset=utf-8",
      "a/\u202E",
    ])
      expect(f({ mediaType: bad }), JSON.stringify(bad)).toEqual({});
  });
  it("every media type the upload rules accept passes the whitelist", () => {
    const real = [
      "application/pdf",
      "image/svg+xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
    ];
    for (const m of real)
      expect(fileEventPayload("DocumentFileStoredEvent", { mediaType: m }), m).toEqual({
        mediaType: m,
      });
  });
  it("purged ids: all must be uuids, 10000 pass, 10001 drop the whole key (pinned silent loss), copy not alias", () => {
    const ids = (n: number) => Array.from({ length: n }, () => V);
    expect(fileEventPayload("DocumentFilePurgedEvent", { versionIds: [] })).toEqual({
      versionIds: [],
    });
    expect(
      fileEventPayload("DocumentFilePurgedEvent", { versionIds: ids(MAX_PURGED_VERSION_IDS) })[
        "versionIds"
      ],
    ).toHaveLength(MAX_PURGED_VERSION_IDS);
    expect(
      fileEventPayload("DocumentFilePurgedEvent", { versionIds: ids(MAX_PURGED_VERSION_IDS + 1) }),
    ).toEqual({});
    expect(fileEventPayload("DocumentFilePurgedEvent", { versionIds: [V, "nope"] })).toEqual({});
    const src = [V];
    const out = fileEventPayload("DocumentFilePurgedEvent", { versionIds: src })[
      "versionIds"
    ] as string[];
    out.push("x");
    expect(src).toEqual([V]);
  });
});

describe("QA sameContentHash", () => {
  const hex = "ab".repeat(32);
  it("accepts both stored forms, any case, and refuses anything else", () => {
    expect(sameContentHash(hex, hex)).toBe(true);
    expect(sameContentHash(`sha256:${hex}`, hex)).toBe(true);
    expect(sameContentHash(`SHA256:${hex.toUpperCase()}`, hex)).toBe(true);
    for (const bad of [
      null,
      undefined,
      "",
      `sha256:${hex.slice(1)}`,
      `${hex}0`,
      ` ${hex}`,
      `${hex}\n`,
      `sha256:sha256:${hex}`,
      `md5:${hex}`,
    ])
      expect(sameContentHash(bad, hex), String(bad)).toBe(false);
    expect(sameContentHash(hex, hex.toUpperCase())).toBe(false); // the server's own hash is lowercase
    expect(sameContentHash(hex, hex.slice(1))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA opt-in event filter parsing", () => {
  const T = "DocumentFileStoredEvent";
  const sends = (q: string | null, t = T) => eventMatches(q, t);
  it("pinned today: exact name, comma list, other filters still apply", () => {
    expect(sends(`eventType=${T}`)).toBe(true);
    expect(sends(`eventType=DocumentChangeEvent,${T}`)).toBe(true);
    expect(sends(`eventType=${T}&status=approved`, T)).toBe(true);
    expect(eventMatches(`eventType=${T}&status=approved`, T, { status: "draft" })).toBe(false);
    expect(sends(`eventType=${T};documentType=x`)).toBe(true);
    for (const q of [
      null,
      "",
      "eventType=",
      "eventType=,",
      `eventType=${T.toLowerCase()}`,
      `eventType=DocumentFileStored`,
      `status=${T}`,
    ])
      expect(sends(q), String(q)).toBe(false);
  });
  it("pinned today (fail closed): a second eventType parameter is ignored, and spaces after commas lose the name", () => {
    expect(sends(`eventType=DocumentChangeEvent&eventType=${T}`)).toBe(false);
    expect(sends(`eventType=DocumentChangeEvent, ${T}`)).toBe(false);
  });
  // DEFECT (medium, tmf667-events.ts:~38 parseEventTypes): the list is cut at the first character
  // outside [A-Za-z,]. A comma written as %2C (what URLSearchParams and most HTTP clients produce for
  // `eventType=A,B`) therefore keeps only the FIRST type: the subscription silently loses every
  // later type, standard or opt-in. Fails closed for file events, but the subscriber just never gets them.
  it("a url-encoded comma keeps the later event types (fixed, was: only the first survives)", () => {
    expect(sends(`eventType=DocumentChangeEvent%2C${T}`)).toBe(true);
  });
  it("the same list built with URLSearchParams works (fixed, was: %2C)", () => {
    const q = new URLSearchParams({ eventType: `DocumentChangeEvent,${T}` }).toString();
    expect(sends(q)).toBe(true);
  });
  // DEFECT (low-medium, same function): the regex is not anchored to a parameter name, and the value
  // stops at the first non-letter. R1.5 says "exact, case-sensitive". Both are false greens: a name that
  // is NOT the one asked for reaches the subscriber.
  it("eventType=<name>2 is not the opt-in name (fixed, was: digit ends the value, prefix matches)", () => {
    expect(sends(`eventType=${T}2`)).toBe(false);
  });
  it("eventType=<name>-v2 / .x / _x is not the opt-in name (fixed, was: prefix matches)", () => {
    for (const suffix of ["-v2", ".x", "_x", "*", "%20"])
      expect(sends(`eventType=${T}${suffix}`), suffix).toBe(false);
  });
  it("a parameter merely ending in eventType does not opt in (fixed, was: unanchored regex)", () => {
    expect(sends(`xeventType=${T}`)).toBe(false);
    expect(sends(`note=eventType=${T}`)).toBe(false);
  });
  // DEFECT (low, PRE-EXISTING, surfaced by the new opt-in path): queryValue() calls decodeURIComponent
  // on the raw value, which throws URIError on a stray %. eventMatches then throws instead of answering
  // false; whether one bad subscription poisons delivery depends on the caller, which has no try/catch here.
  it("a malformed percent sequence in a filter answers false instead of throwing (fixed, was: URIError)", () => {
    expect(() =>
      eventMatches(`eventType=${T}&documentType=%E0%A4%A`, T, { documentType: "x" }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA scan and extraction bodies", () => {
  const scan = (o: Record<string, unknown>) =>
    scanResultSchema.safeParse({
      result: "clean",
      contentHash: "ab",
      attempt: 1,
      engine: "AV 1.0",
      ...o,
    }).success;
  it("scan body: boundaries and shape", () => {
    expect(scan({})).toBe(true);
    expect(scan({ attempt: 0 })).toBe(false);
    expect(scan({ attempt: MAX_ATTEMPT })).toBe(true);
    expect(scan({ attempt: MAX_ATTEMPT + 1 })).toBe(false);
    expect(scan({ attempt: "1" })).toBe(false);
    expect(scan({ attempt: 1.5 })).toBe(false);
    expect(scan({ engine: "x".repeat(64) })).toBe(true);
    expect(scan({ engine: "x".repeat(65) })).toBe(false);
    for (const engine of ["", "AV\n", "AV;rm", "Äv", "<b>", "AV\u202E"])
      expect(scan({ engine }), engine).toBe(false);
    expect(scan({ contentHash: "a".repeat(200) })).toBe(true);
    for (const contentHash of ["", "a".repeat(201), "a b", "a\n"])
      expect(scan({ contentHash })).toBe(false);
    expect(scan({ extra: 1 })).toBe(false);
    expect(scan({ fields: [] })).toBe(false);
  });
  it("threatName only with infected", () => {
    expect(scan({ result: "infected", threatName: "Eicar-Test" })).toBe(true);
    expect(scan({ result: "clean", threatName: "x" })).toBe(false);
    expect(scan({ result: "error", threatName: "x" })).toBe(false);
    expect(scan({ result: "infected", threatName: "x".repeat(65) })).toBe(false);
    expect(scan({ result: "bogus" })).toBe(false);
  });
  it("an own __proto__ key in the JSON body is refused as an unknown key", () => {
    const body = JSON.parse(
      '{"result":"clean","contentHash":"ab","attempt":1,"engine":"AV","__proto__":{"x":1}}',
    );
    expect(scanResultSchema.safeParse(body).success).toBe(false);
  });
  const field = (over: Record<string, unknown> = {}) => ({
    name: "party",
    value: "Acme",
    confidence: 0.9,
    ...over,
  });
  const ext2 = (o: Record<string, unknown>) =>
    extractionResultSchema.safeParse({ result: "read", attempt: 1, fields: [], ...o });
  it("extraction body: field count, shape, unreadable carries nothing", () => {
    expect(ext2({}).success).toBe(true);
    expect(
      ext2({ fields: Array.from({ length: MAX_EXTRACTED_FIELDS }, () => field()) }).success,
    ).toBe(true);
    expect(
      ext2({ fields: Array.from({ length: MAX_EXTRACTED_FIELDS + 1 }, () => field()) }).success,
    ).toBe(false);
    expect(extractionResultSchema.safeParse({ result: "unreadable", attempt: 1 }).success).toBe(
      true,
    );
    expect(
      extractionResultSchema.safeParse({ result: "unreadable", attempt: 1, fields: [] }).success,
    ).toBe(false);
    expect(extractionResultSchema.safeParse({ result: "read", attempt: 1 }).success).toBe(false);
    for (const bad of [
      { confidence: -0.01 },
      { confidence: 1.0000001 },
      { confidence: "1" },
      { name: "" },
      { source: "a?b" },
      { source: "x".repeat(65) },
      { extra: 1 },
    ])
      expect(ext2({ fields: [field(bad)] }).success, JSON.stringify(bad)).toBe(false);
    for (const ok of [{ confidence: 0 }, { confidence: 1 }, { source: "" }, { source: "page 3/4" }])
      expect(ext2({ fields: [field(ok)] }).success, JSON.stringify(ok)).toBe(true);
  });
  it("field name length counts code points, not UTF-16 units", () => {
    expect(ext2({ fields: [field({ name: "😀".repeat(200) })] }).success).toBe(true);
    expect(ext2({ fields: [field({ name: "😀".repeat(201) })] }).success).toBe(false);
  });
});

describe("QA checkExtractedFields", () => {
  const spec: FieldSpec[] = [
    { name: "party", valueType: "string" },
    { name: "amount", valueType: "number" },
    { name: "signedOn", valueType: "date" },
    { name: "kind", valueType: "enum", enumValues: ["msa", "sow"] },
    { name: "renewal", valueType: "boolean" },
    { name: "shape", valueType: "geometry" },
    { name: "untyped" },
  ];
  const f = (name: string, value: unknown, confidence = 0.95): ExtractedField => ({
    name,
    value,
    confidence,
  });
  const check = (...fields: ExtractedField[]) => checkExtractedFields(fields, spec);
  it("falsy but valid values are accepted: false, 0, empty string, -0", () => {
    const r = check(f("renewal", false), f("amount", 0), f("party", ""), f("untyped", ""));
    expect(r.ok && r.fields.map((x) => x.value)).toEqual([false, 0, "", ""]);
    expect(check(f("amount", -0)).ok).toBe(true);
  });
  it("a missing value is a bad value, never an accepted undefined", () => {
    const r = checkExtractedFields([{ name: "party", confidence: 1 } as ExtractedField], spec);
    expect(r).toMatchObject({ ok: false, code: "badValues" });
  });
  it("values of the wrong type or outside the type are refused, all-or-nothing", () => {
    for (const [n, v] of [
      ["amount", "12"],
      ["amount", NaN],
      ["amount", Infinity],
      ["renewal", "true"],
      ["renewal", 1],
      ["party", 5],
      ["party", null],
      ["kind", "MSA"],
      ["kind", "other"],
      ["kind", "__proto__"],
      ["kind", "constructor"],
      ["signedOn", "2026-02-30"],
      ["signedOn", "2026-2-3"],
      ["signedOn", "2026-02-03T00:00:00Z"],
      ["signedOn", "２０２６-02-03"],
      ["shape", "POINT(1 1)"], // a type the rule does not know is never accepted (pinned)
    ] as [string, unknown][])
      expect(check(f(n, v)).ok, `${n}=${String(v)}`).toBe(false);
    expect(check(f("party", "Acme"), f("amount", "bad"))).toMatchObject({
      ok: false,
      code: "badValues",
      names: ["amount"],
    });
  });
  it("leap days: valid ones pass, century rules hold", () => {
    for (const d of ["2024-02-29", "2000-02-29", "2026-12-31", "2026-01-01"])
      expect(check(f("signedOn", d)).ok, d).toBe(true);
    for (const d of [
      "2023-02-29",
      "1900-02-29",
      "2100-02-29",
      "2026-04-31",
      "2026-00-10",
      "2026-01-00",
      "2026-13-01",
    ])
      expect(check(f("signedOn", d)).ok, d).toBe(false);
  });
  // DEFECT (low, file-hook-fields.ts:92 realDate): Date.UTC maps years 0..99 to 1900..1999, so a real
  // ISO date such as 0099-12-31 or 0000-01-01 is refused (false red). Dates that old are rare; the fix
  // is `setUTCFullYear` after construction.
  it.fails("accepts a valid date in years 0000-0099 (BUG: Date.UTC maps them to 19xx)", () => {
    expect(check(f("signedOn", "0099-12-31")).ok).toBe(true);
  });
  it("string length: 2000 code points pass, 2001 fail, emoji count once", () => {
    expect(check(f("party", "a".repeat(MAX_EXTRACTED_VALUE_CHARS))).ok).toBe(true);
    expect(check(f("party", "a".repeat(MAX_EXTRACTED_VALUE_CHARS + 1))).ok).toBe(false);
    expect(check(f("party", "😀".repeat(MAX_EXTRACTED_VALUE_CHARS))).ok).toBe(true);
    expect(check(f("party", "😀".repeat(MAX_EXTRACTED_VALUE_CHARS + 1))).ok).toBe(false);
  });
  it("control, bidi, invisible and tag characters are refused in text; ZWJ/ZWNJ and ordinary non-ASCII are kept", () => {
    const bad = [
      "\u0000",
      "\n",
      "\t",
      "\u0085",
      "\u2028",
      "\u202E",
      "\u2066",
      "\u200B",
      "\u2060",
      "\uFEFF",
      "\u061C",
      "\u{E0041}",
      "\uD800",
    ];
    for (const c of bad) expect(check(f("party", `a${c}b`)).ok, JSON.stringify(c)).toBe(false);
    for (const ok of ["a\u200Db", "a\u200Cb", "Zoë Ångström 日本語", "👨‍👩‍👧", "a\u00ADb"])
      expect(check(f("party", ok)).ok, ok).toBe(true);
  });
  // DEFECT (low, file-hook-text.ts:9): the deny list is incomplete for the stated purpose ("invisible
  // characters that hide content"). These render as nothing or reorder annotations, and are accepted:
  // U+2061..2064 (invisible math operators), U+3164 (Hangul filler), U+FFF9..FFFB (interlinear
  // annotation), U+E0100 (variation selector supplement: the same smuggling channel as the tag block).
  for (const [name, c] of [
    ["U+2062 invisible times", "\u2062"],
    ["U+3164 Hangul filler", "\u3164"],
    ["U+FFFA interlinear annotation", "\uFFFA"],
    ["U+E0100 variation selector supplement", "\u{E0100}"],
  ] as const)
    it.fails(`refuses ${name} in extracted text (BUG: accepted)`, () => {
      expect(UNSAFE_TEXT.test(`a${c}b`)).toBe(true);
    });
  it("multi-line text is refused (pinned: newline and tab are control characters, an address with a line break fails the whole result)", () => {
    expect(check(f("party", "Line 1\nLine 2")).ok).toBe(false);
  });
  it("names: unknown first, then duplicates, then bad values; escaped and capped at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => f(`nope${i}`, "x"));
    const r = check(...many);
    expect(r).toMatchObject({ ok: false, code: "unknownFields" });
    expect(!r.ok && r.names).toHaveLength(20);
    const evil = check(f("par\u202Ety", "x"));
    expect(!evil.ok && evil.names[0]).toBe("par\uFFFDty");
    expect(check(f("party", "a"), f("party", "b"), f("nope", 1))).toMatchObject({
      code: "unknownFields",
    });
    expect(check(f("party", "a"), f("party", "b"))).toMatchObject({
      code: "duplicateFields",
      names: ["party"],
    });
    const long = check(f("x".repeat(500), "v"));
    expect(!long.ok && [...long.names[0]!].length).toBe(64);
  });
  it("name matching is exact: case, trailing space and look-alike letters do not match", () => {
    for (const n of ["Party", "party ", "pаrty" /* Cyrillic a */, "PARTY"])
      expect(check(f(n, "x")).ok, n).toBe(false);
  });
  it("source: empty becomes null; pinned: the spec's pattern lets URL-looking text through", () => {
    const r = checkExtractedFields([{ ...f("party", "x"), source: "" }], spec);
    expect(r.ok && r.fields[0]!.source).toBeNull();
    expect(ext2Source("https://evil.example/x")).toBe(true); // R3.3 says "never a link"; the regex does not enforce it
  });
});
function ext2Source(source: string) {
  return extractionResultSchema.safeParse({
    result: "read",
    attempt: 1,
    fields: [{ name: "party", value: "x", confidence: 1, source }],
  }).success;
}

describe("QA bandFor", () => {
  it("boundaries around 0.9 and 0.7 (floating point included)", () => {
    expect(bandFor(0.9)).toBe("high");
    expect(bandFor(0.9 - 1e-9)).toBe("medium");
    expect(bandFor(0.7)).toBe("medium");
    expect(bandFor(0.7 - 1e-9)).toBe("low");
    expect(bandFor(0)).toBe("low");
    expect(bandFor(1)).toBe("high");
    expect(bandFor(90 / 100)).toBe("high");
  });
  it("review threshold only raises High: 0.95 raises, 0.5 never lowers, NaN/negative/percent ignored", () => {
    expect(bandFor(0.92, 0.95)).toBe("medium");
    expect(bandFor(0.95, 0.95)).toBe("high");
    expect(bandFor(0.92, 0.5)).toBe("high");
    expect(bandFor(0.92, Number.NaN)).toBe("high");
    expect(bandFor(0.92, -1)).toBe("high");
    expect(bandFor(0.92, 1)).toBe("medium");
    expect(bandFor(1, 1)).toBe("high");
    // pinned: a threshold written as a percentage (95) is ignored, so the document type asked for a
    // stricter cut-off than it gets (fails open to the default 0.9).
    expect(bandFor(0.92, 95)).toBe("high");
  });
});

describe("QA text helpers", () => {
  it("cleanLabel never splits a surrogate pair and counts the ellipsis inside the limit", () => {
    const out = cleanLabel("😀".repeat(10), 5);
    expect([...out]).toHaveLength(5);
    expect(out).toBe("😀😀😀😀…");
    expect(cleanLabel("abc", 3)).toBe("abc");
    expect(cleanLabel("abcd", 3)).toBe("ab…");
  });
  it("cleanLabel replaces lone surrogates and bidi marks, keeps ZWJ", () => {
    expect(cleanLabel("a\uD800b\u202Ec\u200Dd", 50)).toBe("a\uFFFDb\uFFFDc\u200Dd");
  });
  it("codePointSlice keeps short strings as they are", () => {
    expect(codePointSlice("😀😀", 2)).toBe("😀😀");
    expect(codePointSlice("😀😀😀", 2)).toBe("😀😀");
  });
});
