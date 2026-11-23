import { describe, expect, it } from "vitest";
import { resultsSummary } from "@/components/search/search-url";
describe("resultsSummary", () => {
  it("should name the words searched for next to the count", () => {
    expect(resultsSummary("12 documents", " contract ")).toBe('12 documents for "contract"');
  });
  it("should show only the count when nothing was typed", () => {
    expect(resultsSummary("76 documents", undefined)).toBe("76 documents");
    expect(resultsSummary("76 documents", "  ")).toBe("76 documents");
  });
});
