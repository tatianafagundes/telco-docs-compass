// Secondary text (#6a6a6a) on the hover background (#dcdcdc) has a contrast of 3.9:1, under the
// 4.5:1 that WCAG 2.2 AA asks for at this size. In rows that change background on hover, the
// secondary text must turn to the main colour while hovered. Found with an automated scan
// (axe-core) of the hovered rows; this keeps it from coming back.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// File and how many secondary-text spans sit inside a hoverable row.
const ROWS: [string, number][] = [
  ["src/components/search/start-lists.tsx", 1],
  ["src/components/search/results-table.tsx", 3],
];

describe("rows that change background on hover keep their secondary text readable", () => {
  it.each(ROWS)("%s", (file, spans) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("hover:bg-item-hover");
    expect(source).toMatch(/\bgroup\b/);
    expect(source.match(/group-hover:text-text-main/g)?.length).toBe(spans);
  });
});
