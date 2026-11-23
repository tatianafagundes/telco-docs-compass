// A modal Radix menu marks the rest of the page aria-hidden while it is open; axe reports that as
// aria-hidden-focus. Every menu here is non-modal (Escape and a click outside still close it).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("menus are not modal", () => {
  it.each([
    ["src/components/documents/document-menu.tsx", "<DropdownMenu modal={false}>"],
    ["src/components/erad/app-shell.tsx", "<DropdownMenu.Root modal={false}>"],
  ])("%s", (file, root) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain(root);
    expect(source).not.toMatch(/<DropdownMenu(\.Root)?>/);
  });
});
