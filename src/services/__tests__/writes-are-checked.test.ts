// A write whose answer is thrown away cannot fail loudly: the Supabase client never throws, it
// returns `{ error }`. This guard lists the server-function files whose writes are all checked
// (`must(...)`, a helper that uses it, or an `error` that is read), and fails when a new
// unchecked `await ...insert/update/upsert/delete` appears in them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Add a file here once its writes are checked. (document.functions.ts is not listed: its refused-attempt
// record is deliberately best-effort, so a logging failure cannot change the refusal.) Files not listed still have unchecked writes.
const CHECKED = [
  "document-content.functions.ts",
  "document-status.functions.ts",
  "document-first-version.ts",
  "document-update.ts",
  "document-delete.ts",
  "maintenance.ts",
  "document-access.functions.ts",
  "document-review.functions.ts",
  "document-detail-entry.ts",
  "retention.functions.ts",
  "tenant-config-write.functions.ts",
  "idempotency-claim.ts",
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

describe("updates of a document row are pinned to the tenant", () => {
  // `runWrite` has already checked the tenant; the filter on the update is a second lock.
  const FILES = [
    "document-content.functions.ts",
    "document-status.functions.ts",
    "document-review.functions.ts",
    "document-detail-entry.ts",
    "document-update.ts",
  ];
  it.each(FILES)("%s", (file) => {
    const source = readFileSync(`src/services/${file}`, "utf8");
    const loose = source
      .split(";")
      .filter((s) => /\.from\("documents"\)\s*\.update\(/.test(s) && !s.includes("tenant_id"))
      .map((s) => s.trim().slice(0, 80).replace(/\s+/g, " "));
    expect(loose).toEqual([]);
  });
});
