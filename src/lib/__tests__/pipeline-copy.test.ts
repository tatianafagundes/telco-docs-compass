// What the screens say and offer for processing (file-hooks spec R5.1–R5.5).
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
import { keepUnread } from "@/services/file-hook-versions";
import type { PipelineState } from "@/schemas/document";

const ext = (over: Record<string, unknown> = {}) => ({
  mode: "external",
  by: "Acme AV",
  byClient: "c1",
  step: "scan",
  attempt: 1,
  ...over,
});

describe("while a step runs (R5.1)", () => {
  it("an outside step waits for the recorded system, from its start time", () => {
    const since = new Date(2026, 10, 24, 9, 5).toISOString();
    const v = processingView("scanning", ext({ since }));
    expect(v).toMatchObject({ simulated: false, message: null, actions: [] });
    expect(waitingLine(v.waiting!)).toBe("Waiting for Acme AV · Since 09:05");
  });
  it("a long system name is shortened in the middle; no time without a start", () => {
    const v = processingView("reading", ext({ step: "read", by: "A".repeat(20) + "Z".repeat(30) }));
    expect(v.waiting!.system).toHaveLength(32);
    expect(v.waiting!.system.startsWith("AAAA")).toBe(true);
    expect(waitingLine(v.waiting!)).not.toContain("Since");
  });
  it("an outside step with no system connected names what it waits for", () => {
    expect(processingView("scanning", ext({ by: undefined })).waiting!.system).toBe(
      "Your organisation's antivirus",
    );
    expect(processingView("reading", ext({ by: undefined, step: "read" })).waiting!.system).toBe(
      "Your organisation's reader",
    );
  });
  it.each(["scanning", "reading"] as const)(
    "a built-in %s step shows the simulated tooltip and waits for nobody",
    (state) => {
      expect(processingView(state, { mode: "simulated", attempt: 1 })).toEqual({
        label: state === "scanning" ? "Checking for threats" : "Reading details",
        waiting: null,
        simulated: true,
        message: null,
        actions: [],
      });
      expect(processingView(state, null).simulated).toBe(true);
    },
  );
  it.each([
    ["uploading", "No file yet"],
    ["ready", "Ready"],
  ] as const)("%s shows nothing extra (tag %s)", (state, label) => {
    expect(processingView(state, ext())).toEqual({
      label,
      waiting: null,
      simulated: false,
      message: null,
      actions: [],
    });
  });
});

describe("failures and blocked files (R5.2, R5.3)", () => {
  it.each([
    [
      "scanError",
      ext({ reason: "scanError" }),
      "Acme AV couldn't check this file. Try again.",
      ["retry", "delete"],
    ],
    [
      "noResult, scan",
      ext({ reason: "noResult" }),
      "Acme AV didn't answer within 30 minutes. Try again.",
      ["retry", "delete"],
    ],
    [
      "noResult, read",
      ext({ reason: "noResult", step: "read", by: "Acme OCR" }),
      "Acme OCR didn't answer within 30 minutes. Try again, or keep the file without reading.",
      ["retry", "keepUnread", "delete"],
    ],
    [
      "noResult with no step (an old timeout: may have been the scan)",
      { reason: "noResult" },
      "The built-in check didn't answer within 30 minutes. Try again.",
      ["retry", "delete"],
    ],
    [
      "unreadable",
      { reason: "unreadable", step: "read" },
      "We couldn't read the text in this file, so no details were filled in.",
      ["retry", "keepUnread", "delete"],
    ],
    [
      "an old failure with no detail",
      null,
      "We couldn't read the text in this file, so no details were filled in.",
      ["retry", "keepUnread", "delete"],
    ],
    ["noFile", { reason: "noFile" }, "The file never arrived. Add it again.", ["delete"]],
    [
      "scanError of the built-in check",
      { reason: "scanError", step: "scan", mode: "simulated" },
      "The built-in check couldn't check this file. Try again.",
      ["retry", "delete"],
    ],
  ])("%s", (_n, detail, message, actions) => {
    const v = processingView("failed", detail, { nameChars: 32 });
    expect(v.message).toBe(message);
    expect(v.actions).toEqual(actions);
    expect(v.waiting).toBeNull();
  });
  it("Keep without reading is offered exactly when the server would accept it", () => {
    const details: unknown[] = [
      null,
      { reason: "unreadable" },
      { reason: "unreadable", step: "read" },
      { reason: "unreadableAgain" },
      { reason: "scanError" },
      { reason: "scanError", step: "scan" },
      { reason: "noResult" },
      { reason: "noResult", step: "scan" },
      { reason: "noResult", step: "read" },
      { reason: "noFile" },
      { reason: "threat", step: "scan" },
    ];
    for (const d of details)
      expect(processingView("failed", d).actions.includes("keepUnread"), JSON.stringify(d)).toBe(
        keepUnread("failed", d, "11111111-1111-4111-8111-111111111111").ok,
      );
  });
  it("a blocked file names the check, offers a report and delete, and says how to go on", () => {
    expect(processingView("quarantined", ext({ reason: "threat" }))).toEqual({
      label: "Blocked for safety",
      waiting: null,
      simulated: false,
      message:
        "Acme AV found a possible threat in this file. It's blocked: nobody can open or download it. To use this document again, add a clean new version.",
      actions: ["report", "delete"],
    });
    expect(processingView("quarantined", null).message).toMatch(/^The built-in check found/);
  });
  it("a system name with markup is returned as text (the screens never render it as HTML)", () => {
    expect(processingView("failed", ext({ reason: "scanError", by: "<b>x</b>" })).message).toBe(
      "<b>x</b> couldn't check this file. Try again.",
    );
  });
});

describe("the tag of a failed file names what failed (design review B2)", () => {
  it.each([
    [{ reason: "scanError" }, "Couldn't check"],
    [ext({ reason: "noResult" }), "Couldn't check"],
    [{ reason: "noResult" }, "Couldn't check"],
    [{ reason: "noResult", step: "read" }, "Couldn't read"],
    [{ reason: "unreadable", step: "read" }, "Couldn't read"],
    [null, "Couldn't read"],
    [{ reason: "noFile" }, "No file yet"],
  ])("%j: %s", (detail, label) => {
    expect(processingView("failed", detail).label).toBe(label);
  });
  it("an upload this page is sending says Uploading, else No file yet", () => {
    expect(processingView("uploading", null, { uploadingHere: true }).label).toBe("Uploading");
    expect(processingView("uploading", null).label).toBe("No file yet");
  });
  it("the panel shows a longer system name than the card", () => {
    const by = "Acme Antivirus Enterprise Gateway Europe";
    expect(processingView("scanning", ext({ by })).waiting!.system).not.toBe(by);
    expect(processingView("scanning", ext({ by }), { nameChars: 80 }).waiting!.system).toBe(by);
  });
});

describe("refetching (R5.4)", () => {
  const now = Date.parse("2026-11-24T10:00:00Z");
  const waiting = (msAgo: number | null) => ({
    pipeline_state: "scanning" as PipelineState,
    pipeline_detail: ext(msAgo === null ? {} : { since: new Date(now - msAgo).toISOString() }),
  });
  it("is off when nothing waits for an outside system", () => {
    expect(pollDelay([], now)).toBe(false);
    expect(
      pollDelay(
        [
          { pipeline_state: "scanning", pipeline_detail: { mode: "simulated" } },
          { pipeline_state: "ready", pipeline_detail: ext() },
          { pipeline_state: "failed", pipeline_detail: ext() },
        ],
        now,
      ),
    ).toBe(false);
  });
  it("every 5 s for the first 2 minutes of a wait, then every 15 s", () => {
    expect(pollDelay([waiting(0)], now)).toBe(POLL_FAST_MS);
    expect(pollDelay([waiting(POLL_SLOW_AFTER_MS - 1)], now)).toBe(POLL_FAST_MS);
    expect(pollDelay([waiting(POLL_SLOW_AFTER_MS)], now)).toBe(POLL_SLOW_MS);
  });
  it("fast while any wait is new; a wait with no start counts as new", () => {
    expect(pollDelay([waiting(10 * 60_000), waiting(1_000)], now)).toBe(POLL_FAST_MS);
    expect(pollDelay([waiting(null)], now)).toBe(POLL_FAST_MS);
  });
});

describe("announcements (R5.5)", () => {
  const doc = (id: string, s: PipelineState, name = `${id}.pdf`) => ({
    id,
    name,
    pipeline_state: s,
  });
  it("once per change; failures and blocked files are urgent", () => {
    const before = new Map<string, PipelineState>([
      ["a", "scanning"],
      ["b", "reading"],
      ["c", "scanning"],
      ["d", "ready"],
    ]);
    expect(
      announcements(before, [
        doc("a", "reading"),
        doc("b", "failed"),
        doc("c", "quarantined"),
        doc("d", "ready"),
        doc("e", "ready"),
      ]),
    ).toEqual([
      { text: "a.pdf: reading details.", urgent: false },
      {
        text: "b.pdf: couldn't read. We couldn't read the text in this file, so no details were filled in.",
        urgent: true,
      },
      {
        text: "c.pdf: blocked for safety. The built-in check found a possible threat in this file.",
        urgent: true,
      },
    ]);
  });
  it("a failure says the same words as the tag, and what happened (design review S9)", () => {
    expect(
      announcements(new Map([["a", "scanning" as PipelineState]]), [
        {
          id: "a",
          name: "R.pdf",
          pipeline_state: "failed",
          pipeline_detail: ext({ reason: "noResult" }),
        },
      ]),
    ).toEqual([
      { text: "R.pdf: couldn't check. Acme AV didn't answer within 30 minutes.", urgent: true },
    ]);
  });
  it("nothing on the first list", () => {
    expect(announcements(new Map(), [doc("a", "failed")])).toEqual([]);
  });
});
