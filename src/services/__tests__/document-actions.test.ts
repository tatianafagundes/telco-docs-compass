import { describe, expect, it } from "vitest";
import { deleteState, editState, nextStep, sendBackState } from "@/services/document-actions";

describe("document actions", () => {
  it("should offer approve to a manager when the document is in review", () => {
    expect(nextStep("manager", "in_review")).toMatchObject({ to: "approved", available: true });
  });
  it("should keep approve unavailable with a reason for a contributor", () => {
    const s = nextStep("contributor", "in_review");
    expect(s?.available).toBe(false);
    expect(s?.reason).toBeTruthy();
  });
  it("should offer no next step when archived", () => {
    expect(nextStep("tenant_admin", "archived")).toBeNull();
  });
  it("should not let a viewer edit details", () => {
    expect(editState("viewer", "draft").available).toBe(false);
  });
  it("should not let anyone edit a superseded document", () => {
    expect(editState("tenant_admin", "superseded").available).toBe(false);
  });
  it("should only offer send back while in review", () => {
    expect(sendBackState("manager", "draft")).toBeNull();
    expect(sendBackState("manager", "in_review")?.available).toBe(true);
  });
  it("should block delete under legal hold or retention", () => {
    expect(deleteState("manager", true, null, "2026-11-10").available).toBe(false);
    expect(deleteState("manager", false, "2030-01-01", "2026-11-10").available).toBe(false);
    expect(deleteState("manager", false, "2020-01-01", "2026-11-10").available).toBe(true);
    expect(deleteState("viewer", false, null, "2026-11-10").available).toBe(false);
  });
});
