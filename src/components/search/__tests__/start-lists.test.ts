import { describe, expect, it } from "vitest";
import { startSections } from "@/components/search/start-sections";

const titles = (o: { isAdmin: boolean; canReview: boolean }) =>
  startSections(o).map((s) => s.title);

describe("start page lists", () => {
  it("shows people who check and approve what waits for them, named for what it counts", () => {
    expect(titles({ isAdmin: false, canReview: true })).toEqual([
      "Details to check",
      "Waiting for approval",
      "Recently changed",
      "Expiring in the next 90 days",
    ]);
    const approval = startSections({ isAdmin: false, canReview: true })[1];
    expect(approval?.filters).toEqual({ statuses: ["in_review"] });
  });
  it("does not show review lists to someone who cannot review", () => {
    expect(titles({ isAdmin: false, canReview: false })).toEqual([
      "Recently changed",
      "Expiring in the next 90 days",
    ]);
  });
  it("adds holds for administrators", () => {
    expect(titles({ isAdmin: true, canReview: true }).at(-1)).toBe("On legal hold");
  });
  it("never says 'Nice work' about an empty list", () => {
    for (const s of startSections({ isAdmin: true, canReview: true }))
      expect(s.empty).not.toMatch(/nice work/i);
  });
});
