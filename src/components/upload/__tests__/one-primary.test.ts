// EDS: one primary action per view. On a record page with a document open, the panel's action
// leads, so "Add documents" becomes a default button.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("one primary action on the record page", () => {
  it("passes secondary while a document panel is open, and the button honours it", () => {
    const page = readFileSync("src/routes/_authenticated/records.$entityId.tsx", "utf8");
    const add = readFileSync("src/components/upload/add-documents.tsx", "utf8");
    expect(page).toContain("secondary={Boolean(doc)}");
    expect(add).toContain('variant={secondary ? "default" : "primary"}');
  });
});
