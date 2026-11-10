import { describe, expect, it } from "vitest";
import { deleteState, editState, nextStep, purgeState, sendBackState } from "@/services/document-actions";

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

describe("purgeState", () => {
  it("should block permanent deletion under legal hold", () => {
    expect(purgeState("tenant_admin", true, null, "2026-11-10").available).toBe(false);
  });
  it("should block permanent deletion before the keep-until date", () => {
    expect(purgeState("tenant_admin", false, "2036-07-01", "2026-11-10").reason).toBe("This document must be kept until 2036-07-01.");
  });
  it("should allow only administrators", () => {
    expect(purgeState("manager", false, null, "2026-11-10").available).toBe(false);
    expect(purgeState("tenant_admin", false, "2020-01-01", "2026-11-10").available).toBe(true);
  });
});

import { sharedOnlyRole } from "@/services/document-actions";
describe("sharedOnlyRole", () => {
  it("should cap a manager at viewer when the share is view only", () => {
    expect(sharedOnlyRole("manager", "view")).toBe("viewer");
  });
  it("should cap a manager at contributor when the share allows editing", () => {
    expect(sharedOnlyRole("manager", "edit")).toBe("contributor");
  });
  it("should keep a viewer as viewer even with an edit share", () => {
    expect(sharedOnlyRole("viewer", "edit")).toBe("viewer");
  });
});

import { approvedSummary } from "@/services/document-actions";

describe("approvedSummary", () => {
  const d = (id: string, status: "draft" | "in_review" | "approved" | "effective" | "expired") => ({ id, status });
  it("should show only approved and effective documents when a record has mixed statuses", () => {
    const s = approvedSummary([d("a", "draft"), d("b", "effective"), d("c", "approved"), d("e", "expired")]);
    expect(s.shown.map((x) => x.id)).toEqual(["b", "c"]);
    expect(s.more).toBe(0);
  });
  it("should cap at 3 and count the rest when there are more", () => {
    const s = approvedSummary(["1", "2", "3", "4", "5"].map((i) => d(i, "approved")));
    expect(s.shown).toHaveLength(3);
    expect(s.more).toBe(2);
  });
  it("should list documents in review when none is approved", () => {
    const s = approvedSummary([d("a", "in_review"), d("b", "draft")]);
    expect(s.shown).toEqual([]);
    expect(s.inReview.map((x) => x.id)).toEqual(["a"]);
  });
});
