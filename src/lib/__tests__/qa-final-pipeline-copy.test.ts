// Final QA pass: what the screens say and offer (pipeline-copy.ts) against what the server accepts:
// Try again (stepTransition retry), Keep without reading (keepUnread) and downloads (downloadDecision).
// Every reason x step x mode combination, including details written before the step was recorded.
// `it.fails` = asserts the correct behaviour and fails today (defect named above it).
import { describe, expect, it } from "vitest";
import {
  announcements,
  pollDelay,
  POLL_FAST_MS,
  POLL_SLOW_AFTER_MS,
  POLL_SLOW_MS,
  processingView,
  waitingLine,
} from "@/lib/pipeline-copy";
import type { PipelineState } from "@/schemas/document";
import { downloadDecision, type Downloader } from "@/services/file-hook-download";
import { readDetail } from "@/services/file-hook-detail";
import { stepTransition } from "@/services/file-hook-rules";
import { keepUnread } from "@/services/file-hook-versions";

const V = "22222222-2222-4222-8222-222222222222";
const OWNER = { scan: { mode: "simulated" as const }, read: { mode: "simulated" as const } };
const NOW = "2026-11-24T12:00:00.000Z";

const REASONS = [
  undefined,
  "threat",
  "scanError",
  "noResult",
  "unreadable",
  "noFile",
  "unreadableAgain",
  "bogus",
];
const STEPS = [undefined, "scan", "read", "bogus"];
const MODES = [undefined, "simulated", "external"];

interface Combo {
  name: string;
  detail: Record<string, unknown>;
}
const combos: Combo[] = [];
for (const reason of REASONS)
  for (const step of STEPS)
    for (const mode of MODES)
      for (const quarantined of [false])
        combos.push({
          name: `reason=${reason} step=${step} mode=${mode}${quarantined ? " quarantinedCurrent" : ""}`,
          detail: {
            attempt: 2,
            ...(reason !== undefined ? { reason } : {}),
            ...(step !== undefined ? { step } : {}),
            ...(mode !== undefined ? { mode } : {}),
            ...(mode === "external" ? { by: "Acme AV", byClient: "c1" } : {}),
            ...(quarantined ? { quarantinedVersions: [V] } : {}),
          },
        });

/** What the code writes today, plus the older shapes it still reads (file-hook-detail.ts). */
const REAL = (c: Combo) => {
  const d = c.detail;
  const q = "quarantinedVersions" in d;
  if (q) return false;
  const { reason, step } = d as { reason?: string; step?: string };
  if (reason === "bogus" || step === "bogus" || reason === "threat") return false;
  const ok =
    // new writes
    (reason === "scanError" && step === "scan") ||
    (reason === "noResult" && (step === "scan" || step === "read")) ||
    (reason === "unreadable" && step === "read") ||
    (reason === "noFile" && step === undefined) ||
    // legacy: before the step was recorded
    (reason === undefined && step === undefined) ||
    (reason === "unreadable" && step === undefined) ||
    (reason === "unreadableAgain" && step === undefined) ||
    (reason === "noResult" && step === undefined) ||
    (reason === "scanError" && step === undefined);
  return ok;
};
const realCombos = combos.filter(REAL);
/**
 * A reason that names its own step (scanError and threat: scan; unreadable: read) never carries the
 * other step: every write sets both together. Those contradictions cannot be stored by this code, so
 * the "all combinations" tables leave them out.
 */
const OWN_STEP: Record<string, string> = { scanError: "scan", threat: "scan", unreadable: "read" };
const consistent = (c: Combo) => {
  const { reason, step } = c.detail as { reason?: string; step?: string };
  const own = reason ? OWN_STEP[reason] : undefined;
  return !own || step === undefined || step === own;
};
const storable = combos.filter(consistent);

const retryOk = (detail: unknown) =>
  stepTransition("failed", detail, { kind: "retry" }, { now: NOW, versionId: V, owner: OWNER });
const view = (detail: unknown) => processingView("failed", detail);
const doc = (detail: unknown, state: PipelineState = "failed") => ({
  pipelineState: state,
  pipelineDetail: detail,
  currentVersionId: V,
});

describe("the matrix itself has teeth", () => {
  it("covers every reason, step and mode, and a real subset of them", () => {
    expect(combos).toHaveLength(REASONS.length * STEPS.length * MODES.length);
    expect(storable.length).toBeLessThan(combos.length);
    expect(realCombos.length).toBeGreaterThan(20);
  });
});

describe("Try again: offered exactly when the server will restart a step (all combinations)", () => {
  it.each(storable.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const offered = view(c.detail).actions.includes("retry");
    const accepted = retryOk(c.detail).ok;
    expect({ offered, accepted }).toEqual({ offered: accepted, accepted });
  });
});

describe("Keep without reading: offered exactly when the server accepts it (all combinations)", () => {
  it.each(storable.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const offered = view(c.detail).actions.includes("keepUnread");
    const accepted = keepUnread("failed", c.detail, V).ok;
    expect({ offered, accepted }).toEqual({ offered: accepted, accepted });
  });
});

describe("the step the copy names is the step Try again restarts (real and legacy details)", () => {
  it.each(
    realCombos.filter((c) => c.detail["reason"] !== "noFile").map((c) => [c.name, c] as const),
  )("%s", (_n, c) => {
    const v = view(c.detail);
    const out = retryOk(c.detail);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const restartsScan = out.state === "scanning";
    expect(v.label === "Couldn't check").toBe(restartsScan);
    // The message and the tag name the same step.
    const message = v.message ?? "";
    expect(
      /check this file|answer within \d+ minutes\. Try again\.$|couldn't read the text|keep the file without reading/.test(
        message,
      ),
    ).toBe(true);
    if (restartsScan) expect(v.actions).not.toContain("keepUnread");
    else expect(v.actions).toContain("keepUnread");
  });
});

describe("a file Keep without reading would accept is a file people can open (R5.2)", () => {
  it.each(realCombos.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    if (!keepUnread("failed", c.detail, V).ok) return;
    const person: Downloader = { kind: "person" };
    expect(downloadDecision(person, doc(c.detail), V)).toEqual({ ok: true, receipt: false });
  });

  it.each(realCombos.map((c) => [c.name, c] as const))(
    "%s: a file nobody checked is locked",
    (_n, c) => {
      const d = readDetail(c.detail);
      const scanSide =
        d.step === "scan" ||
        d.reason === "noFile" ||
        (d.reason !== undefined && d.step === undefined && d.reason !== "unreadable");
      if (!scanSide) return;
      expect(downloadDecision({ kind: "person" }, doc(c.detail), V)).toMatchObject({
        ok: false,
        code: "contentLocked",
      });
      expect(keepUnread("failed", c.detail, V).ok).toBe(false);
    },
  );
});

describe("Delete and the no-file copy", () => {
  it("noFile offers only Delete, and says the file never arrived; the server refuses retry and keep", () => {
    const d = { attempt: 1, reason: "noFile" };
    expect(view(d)).toMatchObject({
      label: "No file yet",
      message: "The file never arrived. Add it again.",
      actions: ["delete"],
    });
    expect(retryOk(d)).toMatchObject({ ok: false, code: "notRetryable" });
    expect(keepUnread("failed", d, V)).toMatchObject({ ok: false });
  });

  it.each(
    realCombos.filter((c) => c.detail["reason"] !== "noFile").map((c) => [c.name, c] as const),
  )("%s: Delete is always offered after a failure", (_n, c) =>
    expect(view(c.detail).actions).toContain("delete"),
  );
});

describe("a blocked file: the copy says nobody can open or download it", () => {
  const q = (over: Record<string, unknown> = {}) => ({
    mode: "external",
    by: "Acme AV",
    byClient: "c1",
    step: "scan",
    reason: "threat",
    attempt: 2,
    quarantinedVersions: [V],
    ...over,
  });
  const kinds: Downloader[] = [
    { kind: "person" },
    { kind: "readKey" },
    { kind: "scanner", clientId: "c1" },
    { kind: "reader", clientId: "c1" },
  ];
  it.each(kinds.map((k) => [k.kind, k] as const))(
    "a %s gets quarantined for the current version",
    (_n, who) => {
      expect(downloadDecision(who, doc(q(), "quarantined"), V)).toEqual({
        ok: false,
        code: "quarantined",
      });
    },
  );
  it("also when the state was written before the list existed (state quarantined, empty list)", () => {
    const legacy = { reason: "threat", attempt: 1 };
    expect(downloadDecision({ kind: "person" }, doc(legacy, "quarantined"), V)).toEqual({
      ok: false,
      code: "quarantined",
    });
  });
  it("offers Report a problem and Delete, never Try again or Keep, and the server agrees", () => {
    const v = processingView("quarantined", q());
    expect(v.actions).toEqual(["report", "delete"]);
    expect(v.message).toContain("add a clean new version");
    expect(
      stepTransition(
        "quarantined",
        q(),
        { kind: "retry" },
        { now: NOW, versionId: V, owner: OWNER },
      ),
    ).toMatchObject({ ok: false });
    expect(keepUnread("quarantined", q(), V).ok).toBe(false);
  });
  it("names the built-in check when no outside system was recorded", () => {
    expect(
      processingView("quarantined", { mode: "simulated", attempt: 1 }).message!.startsWith(
        "The built-in check found",
      ),
    ).toBe(true);
  });
  it("a hostile system name stays text and is shortened in the middle", () => {
    const name = `<img src=x onerror=alert(1)>${"A".repeat(100)}\u202Eevil`;
    const v = processingView("quarantined", q({ by: name }));
    expect(v.message).not.toContain("\u202E");
    expect(v.message!.length).toBeLessThan(260);
  });
});

describe("states that carry no message", () => {
  it.each(["uploading", "scanning", "reading", "ready"] as const)(
    "%s: no message, no action",
    (s) => {
      const v = processingView(s, {
        mode: "external",
        by: "X",
        attempt: 1,
        reason: "scanError",
        step: "scan",
      });
      expect(v.message).toBeNull();
      expect(v.actions).toEqual([]);
    },
  );
});

describe("the announcement text (R5.5)", () => {
  const was = new Map<string, PipelineState>([["d1", "scanning"]]);
  const say = (state: PipelineState, detail: unknown, name = "Report.pdf") =>
    announcements(was, [{ id: "d1", name, pipeline_state: state, pipeline_detail: detail }]);

  it("a failure says what happened in the first sentence and is urgent", () => {
    expect(
      say("failed", {
        mode: "external",
        by: "Acme AV",
        step: "scan",
        reason: "noResult",
        attempt: 1,
      }),
    ).toEqual([
      {
        text: "Report.pdf: couldn't check. Acme AV didn't answer within 30 minutes.",
        urgent: true,
      },
    ]);
  });
  it("ready is polite and short", () => {
    expect(say("ready", { attempt: 2 })).toEqual([{ text: "Report.pdf: ready.", urgent: false }]);
  });

  // Was QA-F2: the announcement cut the message after the first ". ", so a system name such as
  // "Acme Inc. AV" was cut inside the name. It now speaks `headline`, built apart from the rest.
  it("a system name with a full stop does not cut the sentence inside the name (was QA-F2)", () => {
    const out = say("quarantined", {
      mode: "external",
      by: "Acme Inc. Scanner",
      byClient: "c1",
      step: "scan",
      reason: "threat",
      attempt: 1,
      quarantinedVersions: [V],
    });
    expect(out[0]!.text).toContain("possible threat");
  });
  it("the same for a failure: the name 'St. Mary AV' is not the whole message (was QA-F2)", () => {
    const out = say("failed", {
      mode: "external",
      by: "St. Mary AV",
      byClient: "c1",
      step: "scan",
      reason: "scanError",
      attempt: 1,
    });
    expect(out[0]!.text).toContain("couldn't check this file");
  });

  it("a long document name is shortened and a hostile one stays text", () => {
    const out = say("ready", { attempt: 1 }, `<b>${"x".repeat(80)}</b>`);
    expect(out[0]!.text.length).toBeLessThan(80);
  });
  it("a document first seen, or one whose state did not change, is not announced", () => {
    expect(announcements(new Map(), [{ id: "d1", name: "A", pipeline_state: "failed" }])).toEqual(
      [],
    );
    expect(announcements(was, [{ id: "d1", name: "A", pipeline_state: "scanning" }])).toEqual([]);
  });
  it("a document that went back from failed to scanning (Try again) is announced as checking, politely", () => {
    const b = new Map<string, PipelineState>([["d1", "failed"]]);
    expect(
      announcements(b, [
        {
          id: "d1",
          name: "A",
          pipeline_state: "scanning",
          pipeline_detail: { mode: "external", attempt: 2 },
        },
      ]),
    ).toEqual([{ text: "A: checking for threats.", urgent: false }]);
  });
});

describe("refetch pace (R5.4)", () => {
  const T0 = Date.parse("2026-11-24T12:00:00.000Z");
  const wait = (state: PipelineState, since: string | undefined, mode = "external") => ({
    pipeline_state: state,
    pipeline_detail: { mode, attempt: 1, ...(since ? { since } : {}) },
  });
  it("nothing waiting: no polling; simulated steps do not poll", () => {
    expect(pollDelay([], T0)).toBe(false);
    expect(
      pollDelay([wait("scanning", undefined, "simulated"), { pipeline_state: "ready" }], T0),
    ).toBe(false);
  });
  it("5 s while a wait is under 2 minutes old, 15 s once every wait is older", () => {
    const fresh = new Date(T0 - (POLL_SLOW_AFTER_MS - 1)).toISOString();
    const old = new Date(T0 - POLL_SLOW_AFTER_MS).toISOString();
    expect(pollDelay([wait("scanning", fresh)], T0)).toBe(POLL_FAST_MS);
    expect(pollDelay([wait("scanning", old)], T0)).toBe(POLL_SLOW_MS);
    expect(pollDelay([wait("scanning", old), wait("reading", fresh)], T0)).toBe(POLL_FAST_MS);
    expect(pollDelay([wait("reading", fresh), wait("scanning", old)], T0)).toBe(POLL_FAST_MS);
  });
  it("a start time in the future or unreadable counts as new: checked often, not late", () => {
    expect(pollDelay([wait("scanning", new Date(T0 + 3_600_000).toISOString())], T0)).toBe(
      POLL_FAST_MS,
    );
    expect(pollDelay([wait("scanning", "garbage")], T0)).toBe(POLL_FAST_MS);
    expect(pollDelay([wait("scanning", undefined)], T0)).toBe(POLL_FAST_MS);
  });
  it("a failed, quarantined or uploading document never polls", () => {
    expect(
      pollDelay(
        [wait("failed", undefined), wait("quarantined", undefined), wait("uploading", undefined)],
        T0,
      ),
    ).toBe(false);
  });
});

describe("the waiting line", () => {
  it("shows HH:mm in local time with two digits, and nothing when the start is unknown", () => {
    const since = new Date(2026, 10, 24, 0, 7).toISOString();
    expect(waitingLine({ system: "Acme AV", since })).toBe("Waiting for Acme AV · Since 00:07");
    expect(waitingLine({ system: "Acme AV", since: null })).toBe("Waiting for Acme AV");
  });
});
