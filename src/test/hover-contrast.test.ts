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

describe("the review page keeps status colours off text", () => {
  // EDS uses the status greens for icons, borders and stripes; as text they fall under 4.5:1.
  const PAGE = "src/routes/_authenticated/records.$entityId_.review.$docId.tsx";
  it("the 'all details checked' line is in the main text colour with a green icon", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).not.toMatch(/<p[^>]*text-status-cleared/);
    expect(source).toMatch(/<CircleCheck[^>]*text-status-cleared/);
  });
  it("secondary text in a selected detail row turns to the main colour", () => {
    const source = readFileSync("src/components/review/field-row.tsx", "utf8");
    expect(source.match(/selected \? "text-text-main" : "text-text-secondary"/g)?.length).toBe(2);
  });
});

// The row of the document open in the side panel is solid blue (fill-item-selected). Dark text on it
// was 3.4:1 in the light theme and only showed when the pointer was away from the row: hovering
// swaps the background, so an automated scan with the mouse resting on the row passed.
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
function token(theme: "light" | "dark", name: string): string {
  const css = readFileSync("src/styles/tokens.css", "utf8");
  const block =
    theme === "light"
      ? css.split(':root[data-theme="dark"]')[0]!
      : css.split(':root[data-theme="dark"]')[1]!;
  const m = block.match(new RegExp(`--${name}: (#[0-9a-f]{6});`));
  if (!m) throw new Error(`${name} not found for ${theme}`);
  return m[1]!;
}
describe("the open document's row in the results list", () => {
  it.each(["light", "dark"] as const)(
    "keeps its text readable on the selected fill (%s)",
    (theme) => {
      for (const fill of ["fill-item-selected", "fill-item-selected-hover"])
        expect(
          contrast(token(theme, "text-on-primary"), token(theme, fill)),
        ).toBeGreaterThanOrEqual(4.5);
    },
  );
  it("is the reason the row must not keep the main text colour in the light theme", () => {
    expect(
      contrast(token("light", "text-main"), token("light", "fill-item-selected")),
    ).toBeLessThan(4.5);
  });
  it("switches its text to the on-primary colour and stays blue on hover", () => {
    const source = readFileSync("src/components/search/results-table.tsx", "utf8");
    expect(source).toContain(
      'active && "bg-item-selected text-text-on-primary hover:bg-item-selected-hover"',
    );
  });
});
