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

import { contentEditState } from "@/services/document-actions";

describe("approved content actions", () => {
  it("should keep Edit details available on an effective document", () => {
    expect(editState("manager", "effective").available).toBe(true);
  });
  it("should make content editing unavailable with a reason on an effective document", () => {
    const s = contentEditState("manager", "effective");
    expect(s.available).toBe(false);
    expect(s.reason).toBeTruthy();
  });
  it("should allow content editing on a draft", () => {
    expect(contentEditState("manager", "draft").available).toBe(true);
  });
});

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
import { APPROVED_CONTENT_REASON, manageState } from "@/services/document-actions";

describe("BR-004 shared-only role", () => {
  it("BR-004 a manage share caps a manager at contributor, a viewer stays viewer", () => {
    expect(sharedOnlyRole("manager", "manage")).toBe("contributor");
    expect(sharedOnlyRole("tenant_admin", "edit")).toBe("contributor");
    expect(sharedOnlyRole("viewer", "manage")).toBe("viewer");
    expect(sharedOnlyRole("viewer", "view")).toBe("viewer");
    expect(sharedOnlyRole("contributor", "edit")).toBe("contributor");
  });
});

describe("BR-011 send back", () => {
  it("BR-011 send back needs review: reviewer may, contributor may not, and only while in review", () => {
    expect(sendBackState("reviewer", "in_review")).toEqual({ available: true });
    expect(sendBackState("contributor", "in_review")).toEqual({ available: false, reason: "Only reviewers and managers can do this." });
    expect(sendBackState("manager", "approved")).toBeNull();
  });
});

describe("BR-014 next-step labels", () => {
  it("BR-014 labels: Send for approval, Approve, Make effective, Mark as superseded, Archive", () => {
    expect(nextStep("manager", "draft")).toMatchObject({ to: "in_review", label: "Send for approval" });
    expect(nextStep("manager", "in_review")).toMatchObject({ to: "approved", label: "Approve" });
    expect(nextStep("manager", "approved")).toMatchObject({ to: "effective", label: "Make effective" });
    expect(nextStep("manager", "effective")).toMatchObject({ to: "superseded", label: "Mark as superseded" });
    expect(nextStep("manager", "superseded")).toMatchObject({ to: "archived", label: "Archive" });
    expect(nextStep("manager", "expired")).toMatchObject({ to: "archived", label: "Archive" });
    expect(nextStep("manager", "archived")).toBeNull();
  });
});

describe("BR-015/BR-016 reasons", () => {
  it("BR-015 role reasons: edit, review, manage", () => {
    expect(editState("viewer", "draft")).toEqual({ available: false, reason: "Your role can view this document but not change it." });
    expect(nextStep("viewer", "draft")?.reason).toBe("Your role can view this document but not change it.");
    expect(nextStep("contributor", "in_review")?.reason).toBe("Only reviewers and managers can do this.");
    expect(nextStep("reviewer", "approved")?.reason).toBe("Only managers and administrators can do this.");
    expect(manageState("reviewer")).toEqual({ available: false, reason: "Only managers and administrators can do this." });
    expect(manageState("manager")).toEqual({ available: true });
  });
  it("BR-016 frozen edit reason", () => {
    for (const s of ["superseded", "expired", "archived"] as const) {
      expect(editState("tenant_admin", s)).toEqual({ available: false, reason: "This document is closed, so its details are kept as they are." });
    }
  });
});

describe("BR-051/BR-052 delete and permanent deletion reasons", () => {
  const today = "2026-11-10";
  it("BR-051 soft delete needs manage and names the hold or the keep-until date", () => {
    expect(deleteState("reviewer", false, null, today)).toEqual({ available: false, reason: "Only managers and administrators can do this." });
    expect(deleteState("manager", true, null, today)).toEqual({ available: false, reason: "A legal hold keeps this document safe. Release the hold first." });
    expect(deleteState("manager", false, "2030-01-01", today)).toEqual({ available: false, reason: "This document must be kept until 2030-01-01." });
    expect(deleteState("manager", false, today, today)).toEqual({ available: true });
  });
  it("BR-052 permanent deletion: administrators only, blocked by a hold, blocked while retain_until >= today", () => {
    expect(purgeState("manager", false, null, today)).toEqual({ available: false, reason: "Only administrators can delete permanently." });
    expect(purgeState("tenant_admin", true, null, today)).toEqual({ available: false, reason: "A legal hold blocks permanent deletion. Release the hold first." });
    expect(purgeState("tenant_admin", false, today, today)).toEqual({ available: false, reason: `This document must be kept until ${today}.` });
    expect(purgeState("master_admin", false, "2026-11-09", today)).toEqual({ available: true });
  });
});

describe("BR-143 approved content reason", () => {
  it("BR-143 content editing on an approved document explains that names and descriptions still change", () => {
    expect(APPROVED_CONTENT_REASON).toBe("This document is approved, so its content stays as it was approved. You can still rename it or update its description.");
    expect(contentEditState("manager", "approved")).toEqual({ available: false, reason: APPROVED_CONTENT_REASON });
    expect(contentEditState("viewer", "approved").reason).toBe("Your role can view this document but not change it.");
    expect(contentEditState("manager", "archived").reason).toBe("This document is closed, so its details are kept as they are.");
  });
});
