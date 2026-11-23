// EDS filter pattern: the filter icon hides and shows the vertical filter panel (R22).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("results filter panel", () => {
  it("can be hidden and shown, and says which state it is in", () => {
    const src = readFileSync("src/routes/_authenticated/documents.tsx", "utf8");
    expect(src).toContain("aria-expanded={filtersShown}");
    expect(src).toContain('aria-label={filtersShown ? "Hide filters" : "Show filters"}');
    expect(src).toContain("{filtersShown ? (");
  });
});
