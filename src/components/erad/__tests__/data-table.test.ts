// Row actions (Release a hold, Restore a deleted document) are the point of those rows. Hiding them
// until hover left touch users, and anyone who does not hover, without them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DataTable row actions", () => {
  const source = readFileSync("src/components/erad/data-table.tsx", "utf8");
  it("are always visible", () => {
    expect(source).toContain("rowActions");
    expect(source).not.toMatch(/opacity-0/);
    expect(source).not.toMatch(/group-hover:opacity/);
  });
});
