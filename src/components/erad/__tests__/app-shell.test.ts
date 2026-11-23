// The skip link only works when its target exists in the same file; keep the pair together.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app shell", () => {
  const source = readFileSync("src/components/erad/app-shell.tsx", "utf8");
  it("starts with a skip link to the main content", () => {
    expect(source).toContain('href="#main-content"');
    expect(source.indexOf('href="#main-content"')).toBeLessThan(source.indexOf("<header"));
    expect(source).toContain("Skip to main content");
  });
  it("makes <main> the focus target of that link", () => {
    expect(source).toMatch(/<main\s+id="main-content"\s+tabIndex=\{-1\}/);
  });
  it("does not mark Admin itself as current when an area inside it is (tree navigation)", () => {
    const admin = source.slice(source.indexOf('to="/admin"'), source.indexOf('to="/admin"') + 300);
    expect(admin).toContain("activeOptions={{ exact: true }}");
  });
  it("never renders the Admin chevron as a disabled button", () => {
    expect(source).not.toMatch(/disabled=\{inside\}/);
  });
  it("lets people show or hide the navigation labels, and links the product name home (EDS)", () => {
    expect(source).toContain('aria-controls="main-nav"');
    expect(source).toContain("Hide navigation labels");
    expect(source).toMatch(/<Link to=\{homeFor\(role\)\}[^>]*>\s*Documents/);
  });
  it("puts the label in a tooltip when only icons show", () => {
    expect(source).toContain("<Tooltip content={label}>");
  });
});
