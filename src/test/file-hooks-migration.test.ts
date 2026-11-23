// The file-event trigger (drizzle/migrations/0016_file_hooks.sql) may only put ids, hashes, sizes,
// media types, attempts and the hold flag in events: never content, values, names or reasons.
// Behaviour (one event per transition, none on a no-op) was checked on PGlite when it was written;
// this guard keeps the payload keys from growing unnoticed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("drizzle/migrations/0016_file_hooks.sql", "utf8");
const ALLOWED = new Set([
  "versionId",
  "contentHash",
  "sizeBytes",
  "mediaType",
  "attempt",
  "versionIds",
  "legalHold",
  "lifecycleState",
  "previous",
]);
describe("file hooks migration", () => {
  it("builds event payloads only from the allowed keys", () => {
    const keys = [...sql.matchAll(/jsonb_build_object\(([^;]*?)\)\)/gs)].flatMap((m) =>
      [...m[1]!.matchAll(/'([A-Za-z]+)'\s*,/g)].map((k) => k[1]!),
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !ALLOWED.has(k))).toEqual([]);
  });
  it("never reads hold reasons, descriptions, names or detail values", () => {
    for (const col of [
      "hold_reason",
      "hold_reference",
      "description",
      "name",
      "extraction_fields",
      "value",
    ])
      expect(sql).not.toMatch(new RegExp(`\\b${col}\\b`));
  });
  it("adds the organisation switch with simulated as the default", () => {
    expect(sql).toContain("external_processing jsonb NOT NULL DEFAULT '{}'::jsonb");
  });
});
