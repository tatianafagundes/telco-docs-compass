// Every facet shows a count (design review): Details to check and each record kind included,
// and a 0 is muted.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("facet counts", () => {
  const src = readFileSync("src/components/search/facet-panel.tsx", "utf8");
  it("counts Details to check and the record kinds too", () => {
    expect(src).toContain("useDocumentCount({ ...filters, review: true })");
    expect(src).toContain("useEntityKindCounts(filters, ENTITY_TYPES)");
    expect(src).toContain("(t) => perKind[t]");
  });
  it("mutes a zero", () => {
    expect(src).toContain('n === 0 ? "type-label-12 text-text-disabled"');
  });
});
