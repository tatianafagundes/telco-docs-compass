// A write whose answer is thrown away cannot fail loudly: the Supabase client never throws, it
// returns `{ error }`. This guard lists the server-function files whose writes are all checked
// (`must(...)`, a helper that uses it, or an `error` that is read), and fails when a new
// unchecked `await ...insert/update/upsert/delete` appears in them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Add a file here once its writes are checked. Files not listed still have unchecked writes.
const CHECKED = [
  "document-content.functions.ts",
  "document-status.functions.ts",
  "document-first-version.ts",
  "document-update.ts",
  "document-delete.ts",
  "maintenance.ts",
];
const UNCHECKED_WRITE =
  /^[}\s]*await\s+(?:env\.admin|admin|ctx\.admin)\s*\.from\([^)]*\)\s*\.(?:insert|update|upsert|delete)\b/;

describe("writes in the listed files are checked", () => {
  it.each(CHECKED)("%s", (file) => {
    const source = readFileSync(`src/services/${file}`, "utf8");
    // Statements are split on semicolons so a multi-line chain is seen as one.
    const unchecked = source
      .split(";")
      .map((s) => s.trim())
      .filter((s) => UNCHECKED_WRITE.test(s))
      .map((s) => s.slice(0, 80).replace(/\s+/g, " "));
    expect(unchecked).toEqual([]);
  });
});
