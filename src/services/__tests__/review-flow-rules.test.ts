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
  shortcutModifier,
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
  it("should show ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(shortcutModifier("MacIntel")).toBe("⌘");
    expect(shortcutModifier("Win32")).toBe("Ctrl");
  });
});
