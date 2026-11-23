// The record's documents table follows EDS table anatomy: item count, 25 per page, ISO dates and
// an em dash for missing values.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("record documents table", () => {
  const src = readFileSync("src/routes/_authenticated/records.$entityId.tsx", "utf8");
  it("pages 25 at a time and keeps the page in range", () => {
    expect(src).toContain("const RECORD_PAGE = 25;");
    expect(src).toContain("<Pagination");
    expect(src).toContain("Math.min(pageWanted");
  });
  it("shows ISO dates and an em dash for missing values", () => {
    expect(src).toContain("tableDate(d.updated_at)");
    expect(src).toContain("<EmptyCell />");
    expect(src).not.toContain('"d MMM yyyy"');
  });
});
