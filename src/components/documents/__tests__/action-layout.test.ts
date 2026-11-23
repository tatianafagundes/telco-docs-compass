import { describe, expect, it } from "vitest";
import { actionLayout, gateHint } from "@/components/documents/action-layout";
import { AUTHOR_APPROVE_REASON } from "@/services/review-flow-rules";
const GATE = "Check 2 required details before approving.";
describe("actionLayout (one primary action)", () => {
  it("should make Check details the primary action while a required detail blocks Approve", () => {
    const l = actionLayout("reviewer", "in_review", GATE, false);
    expect(l.primary).toBe("check");
    expect(l.next).toMatchObject({ to: "approved", available: false, reason: GATE });
  });
  it("should make the next step primary once nothing blocks it", () => {
    const l = actionLayout("reviewer", "in_review", undefined, false);
    expect(l.primary).toBe("next");
    expect(l.next).toMatchObject({ to: "approved", available: true });
  });
  it("should keep Approve primary but unavailable for the author, not send them to check", () => {
    const l = actionLayout("reviewer", "in_review", undefined, true);
    expect(l.primary).toBe("next");
    expect(l.next).toMatchObject({ available: false, reason: AUTHOR_APPROVE_REASON });
  });
  it("should hide a step the role can never take, instead of showing it disabled (R21)", () => {
    expect(actionLayout("contributor", "in_review", GATE, false)).toMatchObject({
      primary: null,
      next: null,
    });
    expect(actionLayout("viewer", "draft", undefined, false).next).toBeNull();
    // A reason tied to the document stays visible: the author's own document.
    expect(actionLayout("reviewer", "in_review", undefined, true).next?.reason).toBeTruthy();
  });
  it("should put Send back in More actions only while in review", () => {
    expect(actionLayout("reviewer", "in_review", undefined, false).sendBack).toEqual({});
    expect(actionLayout("contributor", "in_review", undefined, false).sendBack).toBeNull();
    expect(actionLayout("reviewer", "draft", undefined, false).sendBack).toBeNull();
  });
  it("should say in one sentence what checking unlocks", () => {
    expect(gateHint("Approve", 1)).toBe("Approve is available after you check 1 required detail.");
    expect(gateHint("Approve", 3)).toBe("Approve is available after you check 3 required details.");
  });
});
