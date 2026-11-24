// @vitest-environment node
// Migration 0021 on PGlite: the indexes apply on the tables as they are, twice without error, and the
// partial index covers exactly the documents still in a step.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
const SQL = readFileSync("drizzle/migrations/0021_file_hooks_indexes.sql", "utf8");
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE documents (id uuid primary key, tenant_id text not null,
      pipeline_state text not null, updated_at timestamptz not null default now(),
      deleted_at timestamptz, purged_at timestamptz);
    CREATE TABLE document_events (id bigint generated always as identity primary key,
      tenant_id text not null, document_id uuid, version_id uuid, action text not null,
      detail text, created_at timestamptz not null default now());`);
}, 30_000);
describe("migration 0021", () => {
  it("creates the three indexes, and running it again changes nothing", async () => {
    await db.exec(SQL);
    await db.exec(SQL);
    const r = await db.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN ('document_events_version_action', 'document_events_tenant_action_time', 'documents_waiting_steps') ORDER BY indexname",
    );
    expect(r.rows.map((x) => x.indexname)).toEqual([
      "document_events_tenant_action_time",
      "document_events_version_action",
      "documents_waiting_steps",
    ]);
    const partial = r.rows.find((x) => x.indexname === "documents_waiting_steps")!.indexdef;
    expect(partial).toMatch(/uploading/);
    expect(partial).toMatch(/deleted_at IS NULL/);
  });
  it("changes no data and adds no column", async () => {
    await db.exec(SQL);
    expect(SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  });
});
