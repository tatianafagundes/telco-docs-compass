import { describe, expect, it } from "vitest";
import {
  AUTHOR_APPROVE_REASON,
  confidenceReason,
  footerAction,
  formatCheck,
  isContractCritical,
  isOwnDocument,
  journeyStep,
  mostUrgent,
  outcomeSummary,
  pageOrder,
  recordMatch,
} from "@/services/review-flow-rules";

const quote = { id: "quo-se-0412", displayName: "Q-2026-0412 · 480 lines, 5G backup" };

describe("review-flow-rules", () => {
  it("should place a document with unchecked details on the check step", () => {
    expect(journeyStep("in_review", 2)).toBe(0);
    expect(journeyStep("in_review", 0)).toBe(1);
    expect(journeyStep("approved", 0)).toBe(2);
    expect(journeyStep("effective", 0)).toBe(3);
    expect(journeyStep("archived", 0)).toBeNull();
  });

  it("should offer Next detail while details remain", () => {
    expect(footerAction({ role: "manager", status: "in_review", toCheck: 1, gate: { pending: 1, reason: "x" }, own: false })).toEqual({ kind: "next", label: "Next detail" });
  });
  it("should offer Approve document once everything is checked", () => {
    expect(footerAction({ role: "manager", status: "in_review", toCheck: 0, gate: { pending: 0 }, own: false })).toEqual({ kind: "transition", to: "approved", label: "Approve document", available: true });
  });
  it("should block the author from approving their own document", () => {
    const a = footerAction({ role: "manager", status: "in_review", toCheck: 0, gate: { pending: 0 }, own: true });
    expect(a).toMatchObject({ available: false, reason: AUTHOR_APPROVE_REASON });
    expect(isOwnDocument("u1", "u1")).toBe(true);
    expect(isOwnDocument(null, "u1")).toBe(false);
    expect(isOwnDocument("u2", "u1")).toBe(false);
  });
  it("should keep approval closed while required details are unconfirmed", () => {
    expect(footerAction({ role: "manager", status: "in_review", toCheck: 0, gate: { pending: 1, reason: "1 required detail needs checking" }, own: false })).toMatchObject({ available: false, reason: "1 required detail needs checking" });
  });
  it("should offer Send for approval on a draft", () => {
    expect(footerAction({ role: "contributor", status: "draft", toCheck: 0, gate: { pending: 0 }, own: true })).toMatchObject({ kind: "transition", to: "in_review", label: "Send for approval", available: true });
  });
  it("should let a viewer only go back", () => {
    expect(footerAction({ role: "viewer", status: "effective", toCheck: 0, gate: { pending: 0 }, own: false })).toEqual({ kind: "done", label: "Back to document" });
  });

  it("should say whether a quote number matches the record without exposing it", () => {
    expect(recordMatch("quoteNumber", "Q-2026-0412", quote)).toBe("matches");
    expect(recordMatch("quoteNumber", "Q-2026-0999", quote)).toBe("differs");
    expect(recordMatch("vatNumber", "SE000000000001", quote)).toBeNull();
    expect(recordMatch("quoteNumber", "Q-1", null)).toBeNull();
  });
  it("should check Swedish and Norwegian VAT formats", () => {
    expect(formatCheck("vatNumber", "SE000000000001")).toEqual({ ok: true });
    expect(formatCheck("vatNumber", "SE12345")).toMatchObject({ ok: false });
    expect(formatCheck("vatNumber", "NO 923 609 016 MVA")).toEqual({ ok: true });
    expect(formatCheck("vatNumber", "NO923609016")).toMatchObject({ ok: false });
    expect(formatCheck("validUntil", "2026-12-15")).toEqual({ ok: true });
    expect(formatCheck("endDate", "soon")).toMatchObject({ ok: false });
  });
  it("should explain confidence with telecom checks first", () => {
    expect(confidenceReason("high", "differs", null)).toMatch(/Differs from the record/);
    expect(confidenceReason("low", "matches", null)).toBe("Matches the record.");
    expect(confidenceReason("low", null, null)).toMatch(/Hard to read/);
    expect(confidenceReason("high", null, { ok: false, hint: "Bad VAT" })).toBe("Bad VAT");
  });
  it("should treat required details as contract-critical", () => {
    expect(isContractCritical([{ name: "endDate", required: true }], "endDate")).toBe(true);
    expect(isContractCritical([{ name: "endDate" }], "endDate")).toBe(false);
  });
  it("should order details as they appear on the page", () => {
    const f = [
      { name: "vat", source: { page: 1, box: { x: 0, y: 60, w: 1, h: 1 } } },
      { name: "quote", source: { page: 1, box: { x: 0, y: 20, w: 1, h: 1 } } },
      { name: "end", source: { page: 2, box: { x: 0, y: 5, w: 1, h: 1 } } },
    ];
    expect(pageOrder(f).map((x) => x.name)).toEqual(["quote", "vat", "end"]);
  });
  it("should go to contract-critical, then least certain unchecked details first", () => {
    const f = [
      { name: "a", status: "pending" as const, band: "low" as const },
      { name: "b", status: "pending" as const, band: "high" as const },
      { name: "c", status: "accepted" as const, band: "low" as const },
    ];
    expect(mostUrgent(f, () => false)).toBe(0);
    expect(mostUrgent(f, (n) => n === "b")).toBe(1);
    expect(mostUrgent([{ name: "a", status: "accepted" as const, band: null }], () => false)).toBe(-1);
  });
  it("should summarise the outcome", () => {
    expect(outcomeSummary([{ status: "accepted" }, { status: "accepted" }, { status: "edited" }])).toBe("All details checked: 2 confirmed, 1 corrected.");
  });
});

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
describe("BR-022/BR-024/BR-025/BR-026 journey", () => {
  it("BR-022 four-eyes reason text", () => {
    expect(AUTHOR_APPROVE_REASON).toBe("Someone other than the person who added it needs to approve it.");
    expect(isOwnDocument(undefined, "u1")).toBe(false);
  });
  it("BR-024 journey step for a draft, and no journey for closed statuses", () => {
    expect(journeyStep("draft", 3)).toBe(0);
    expect(journeyStep("draft", 0)).toBe(1);
    expect(journeyStep("superseded", 0)).toBeNull();
    expect(journeyStep("expired", 0)).toBeNull();
  });
  it("BR-025 footer action order: role, then gate, then four-eyes", () => {
    const gate = { pending: 1, reason: "1 required detail needs checking" };
    expect(footerAction({ role: "contributor", status: "in_review", toCheck: 0, gate, own: true })).toEqual({
      kind: "transition", to: "approved", label: "Approve document", available: false, reason: "Only reviewers and managers can do this.",
    });
    expect(footerAction({ role: "reviewer", status: "in_review", toCheck: 0, gate, own: true })).toEqual({
      kind: "transition", to: "approved", label: "Approve document", available: false, reason: "1 required detail needs checking",
    });
    expect(footerAction({ role: "reviewer", status: "in_review", toCheck: 0, gate: { pending: 0 }, own: true })).toEqual({
      kind: "transition", to: "approved", label: "Approve document", available: false, reason: "Someone other than the person who added it needs to approve it.",
    });
  });
  it("BR-025 Next detail only for people who can review; a draft offers Send for approval; approved offers Back to document", () => {
    expect(footerAction({ role: "contributor", status: "draft", toCheck: 2, gate: { pending: 2, reason: "2 required details need checking" }, own: true })).toEqual({
      kind: "transition", to: "in_review", label: "Send for approval", available: true,
    });
    expect(footerAction({ role: "viewer", status: "draft", toCheck: 0, gate: { pending: 0 }, own: false })).toEqual({
      kind: "transition", to: "in_review", label: "Send for approval", available: false, reason: "Your role can view this document but not change it.",
    });
    expect(footerAction({ role: "reviewer", status: "draft", toCheck: 1, gate: { pending: 1, reason: "x" }, own: false })).toEqual({ kind: "next", label: "Next detail" });
    expect(footerAction({ role: "manager", status: "approved", toCheck: 0, gate: { pending: 0 }, own: false })).toEqual({ kind: "done", label: "Back to document" });
  });
  it("BR-026 outcome text omits zero parts and reads 'All details checked.' with none", () => {
    expect(outcomeSummary([{ status: "accepted" }, { status: "edited" }, { status: "rejected" }, { status: "rejected" }])).toBe("All details checked: 1 confirmed, 1 corrected, 2 not in the document.");
    expect(outcomeSummary([{ status: "rejected" }])).toBe("All details checked: 1 not in the document.");
    expect(outcomeSummary([])).toBe("All details checked.");
  });
});

describe("BR-033/BR-034 ordering", () => {
  it("BR-033 page order breaks ties by name and treats a missing source as page 1, top", () => {
    const f = [
      { name: "b", source: { page: 1, box: { x: 0, y: 10, w: 1, h: 1 } } },
      { name: "a", source: { page: 1, box: { x: 0, y: 10, w: 1, h: 1 } } },
      { name: "c", source: null },
    ];
    expect(pageOrder(f).map((x) => x.name)).toEqual(["c", "a", "b"]);
  });
  it("BR-034 most urgent: contract-critical, then flagged, then lowest band, then list position", () => {
    const f = [
      { name: "a", status: "pending" as const, band: "high" as const },
      { name: "b", status: "pending" as const, band: "low" as const },
      { name: "c", status: "pending" as const, band: "high" as const },
      { name: "d", status: "pending" as const, band: "high" as const },
    ];
    expect(mostUrgent(f, () => false, (n) => n === "c")).toBe(2);
    expect(mostUrgent(f, (n) => n === "d", (n) => n === "c")).toBe(3);
    expect(mostUrgent(f, () => false)).toBe(1);
    expect(mostUrgent(f.filter((x) => x.band === "high"), () => false)).toBe(0);
  });
});

describe("BR-036 record match", () => {
  it("BR-036 applies only to quote, order and contract numbers; normalises; ignores values under 4 characters", () => {
    expect(recordMatch("orderNumber", "ord se 7731", { id: "ord-se-7731", displayName: "Order O-7731" })).toBe("matches");
    expect(recordMatch("contractNumber", "c-2026-0412", { id: "agr-1", displayName: "C-2026-0412 frame agreement" })).toBe("matches");
    expect(recordMatch("quoteNumber", "Q-1", quote)).toBeNull();
    expect(recordMatch("quoteNumber", "   ", quote)).toBeNull();
    expect(recordMatch("counterparty", "Q-2026-0412", quote)).toBeNull();
  });
});

describe("BR-037/BR-038/BR-039 format hints and confidence reasons", () => {
  it("BR-037 VAT hints", () => {
    expect(formatCheck("vatNumber", "SE12345")).toEqual({ ok: false, hint: "A Swedish VAT number is SE, 10 digits, then 01." });
    expect(formatCheck("vatNumber", "NO923609016")).toEqual({ ok: false, hint: "A Norwegian VAT number is NO, 9 digits, then MVA." });
    expect(formatCheck("vatNumber", "123456789")).toEqual({ ok: false, hint: "A VAT number starts with a two-letter country code." });
    expect(formatCheck("vatNumber", "DE123456789")).toEqual({ ok: true });
    expect(formatCheck("vatNumber", "")).toBeNull();
  });
  it("BR-038 Date and Until fields must read as a date", () => {
    expect(formatCheck("endDate", "soon")).toEqual({ ok: false, hint: "This doesn't read as a date." });
    expect(formatCheck("validUntil", "never")).toEqual({ ok: false, hint: "This doesn't read as a date." });
    expect(formatCheck("counterparty", "soon")).toBeNull();
  });
  it("BR-039 reason priority and exact texts", () => {
    expect(confidenceReason("high", "differs", { ok: false, hint: "Bad" })).toBe("Differs from the record. Compare with the page.");
    expect(confidenceReason("high", "matches", { ok: false, hint: "Bad" })).toBe("Bad");
    expect(confidenceReason("low", "matches", { ok: true })).toBe("Matches the record.");
    expect(confidenceReason("low", null, null)).toBe("Hard to read. Compare with the page.");
    expect(confidenceReason("medium", null, null)).toBe("Partly clear. Worth a quick look.");
    expect(confidenceReason("high", null, null)).toBe("Clearly read.");
    expect(confidenceReason(null, null, null)).toBe("No score. Compare with the page.");
  });
});
