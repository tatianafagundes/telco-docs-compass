import { describe, expect, it } from "vitest";
import { pageItems, pageRange, tableDate, tableDateTime } from "@/lib/table-format";
describe("table formats (EDS table styles)", () => {
  it("shows absolute dates as ISO 8601", () => {
    expect(tableDate("2026-11-10T14:11:00")).toBe("2026-11-10");
    expect(tableDateTime("2026-11-10T14:11:00")).toBe("2026-11-10 14:11");
  });
  it("names the range and the total", () => {
    expect(pageRange(0, 25, 50)).toBe("1–25 of 50");
    expect(pageRange(1, 25, 40)).toBe("26–40 of 40");
    expect(pageRange(0, 25, 0)).toBe("0 of 0");
  });
  it("shows every page up to 7, and an ellipsis beyond", () => {
    expect(pageItems(0, 3)).toEqual([0, 1, 2]);
    expect(pageItems(0, 20)).toEqual([0, 1, 2, 3, "…", 19]);
    expect(pageItems(10, 20)).toEqual([0, "…", 9, 10, 11, "…", 19]);
    expect(pageItems(19, 20)).toEqual([0, "…", 16, 17, 18, 19]);
  });
});
