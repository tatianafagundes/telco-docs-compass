// The file-event trigger (drizzle/migrations/0016_file_hooks.sql) may only put ids, hashes, sizes,
// media types, attempts and the name of a changed attribute in events: never content, values or reasons.
// SQL comments are stripped first, so only code is checked.
// Behaviour (one event per transition, none on a no-op) was checked on PGlite when it was written;
// this guard keeps the payload keys from growing unnoticed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = [
  "0016_file_hooks.sql",
  "0017_file_hooks_safe_attempt.sql",
  "0018_file_hooks_hardening.sql",
]
  .map((f) => readFileSync(`drizzle/migrations/${f}`, "utf8"))
  .join("\n")
  .replace(/--[^\n]*/g, "");
const ALLOWED = new Set([
  "versionId",
  "contentHash",
  "sizeBytes",
  "mediaType",
  "attempt",
  "versionIds",
  "legalHold",
  "changed",
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
  it("never builds an event from the whole row (to_jsonb), or reads hold reasons, descriptions, names or detail values", () => {
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
  it("hardens the latest definitions: empty search_path and versions bound to document and tenant", () => {
    const latest = readFileSync("drizzle/migrations/0018_file_hooks_hardening.sql", "utf8");
    expect(latest.match(/SET search_path = ''/g)?.length).toBe(2);
    expect(latest).toContain("document_id = NEW.id AND tenant_id = NEW.tenant_id");
  });
});
