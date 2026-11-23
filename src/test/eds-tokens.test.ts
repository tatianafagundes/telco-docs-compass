// The colour tokens must keep the EDS values (R24). EDS values below come from the EDS token set
// (@eds/tokens 0.1.0, semantic layer, read through the EDS MCP on 2026-11-24). A difference is
// allowed only when it is listed in DIVERGENCES with its reason and recorded in
// docs/decisions/01-foundation-gaps.md. Anything else fails, so a regenerated tokens.css cannot
// drift from EDS without someone deciding it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
type Pair = { light: string; dark: string };
const EDS: Record<string, Pair & { eds: string }> = {
  "--layer-system": { eds: "background.layer0", light: "#0c0c0c", dark: "#0c0c0c" },
  "--layer-application": { eds: "background.layer1", light: "#ebebeb", dark: "#181818" },
  "--layer-content": { eds: "background.layer2", light: "#fafafa", dark: "#242424" },
  "--text-main": { eds: "text.default", light: "#242424", dark: "#ffffff" },
  "--text-secondary": { eds: "text.secondary", light: "#6a6a6a", dark: "#8b8b8b" },
  "--text-link": { eds: "link.default", light: "#0069c2", dark: "#008cff" },
  "--border-focus": { eds: "focus", light: "#a56ebe", dark: "#8e45b0" },
  "--border-input-error": {
    eds: "textField.validation.error.border",
    light: "#bb0b02",
    dark: "#dc2d37",
  },
  "--status-critical": { eds: "severity.critical", light: "#ed0e00", dark: "#dc2d37" },
  "--status-major": { eds: "severity.major", light: "#d46617", dark: "#e66e19" },
  "--status-minor": { eds: "severity.minor", light: "#fad22d", dark: "#fad22d" },
  "--status-warning": { eds: "severity.warning", light: "#1174e6", dark: "#0077db" },
  "--status-cleared": { eds: "severity.cleared", light: "#329864", dark: "#288964" },
  "--status-indeterminate": { eds: "severity.indeterminate", light: "#878787", dark: "#adadad" },
  "--gradient-ai-start": { eds: "ai.idle.from", light: "#1174e6", dark: "#0077db" },
  "--gradient-ai-end": { eds: "ai.idle.to", light: "#8653f3", dark: "#8653f3" },
};
/** Known differences, theme by theme, each recorded in docs/decisions/01-foundation-gaps.md. */
const DIVERGENCES: Record<string, Partial<Pair>> = {
  "--status-indeterminate": { light: "#6a6a6a" },
  "--gradient-ai-start": { dark: "#3d95fd" },
  "--gradient-ai-end": { dark: "#a07af3" },
};
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [
      m[1],
      m[2]!.toLowerCase(),
    ]),
  );
}
describe("tokens equal EDS", () => {
  const css = readFileSync("src/styles/tokens.css", "utf8");
  const themes = { light: block(css, ":root"), dark: block(css, ':root[data-theme="dark"]') };
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} theme`, () => {
      const wrong = Object.entries(EDS)
        .map(([name, v]) => {
          const want = DIVERGENCES[name]?.[theme] ?? v[theme];
          const have = themes[theme][name];
          return have === want
            ? null
            : `${name} (${v.eds}): ${have ?? "missing"}, expected ${want}`;
        })
        .filter(Boolean);
      expect(wrong).toEqual([]);
    });
  }
  it("records every divergence in the decisions log", () => {
    const log = readFileSync("docs/decisions/01-foundation-gaps.md", "utf8");
    for (const name of Object.keys(DIVERGENCES)) expect(log).toContain(name.slice(2));
  });
});
