// @vitest-environment node
// Runs the file-hook migrations (0016, 0017) on PGlite, an in-process Postgres, against a minimal copy
// of the tables they touch, and checks the outbox rows each change writes.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
const D = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
const events = async () =>
  (
    await db.query<{ event_type: string; payload: Record<string, unknown> }>(
      "select event_type, payload from event_outbox order by id",
    )
  ).rows;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TYPE pipeline_state AS ENUM ('uploading','scanning','reading','ready','failed','quarantined');
    CREATE TABLE tenants (id text primary key);
    CREATE TABLE documents (id uuid primary key, tenant_id text, status text, deleted_at timestamptz,
      purged_at timestamptz, legal_hold boolean default false, current_version_id uuid,
      characteristic jsonb default '[]', pipeline_state pipeline_state default 'uploading', pipeline_detail jsonb);
    CREATE TABLE document_versions (id uuid primary key, document_id uuid, tenant_id text, content_hash text,
      size_bytes bigint, mime_type text);
    CREATE TABLE event_outbox (id bigint generated always as identity primary key, tenant_id text,
      event_type text, document_id uuid, payload jsonb default '{}', created_at timestamptz default now());`);
  for (const f of [
    "0016_file_hooks.sql",
    "0017_file_hooks_safe_attempt.sql",
    "0018_file_hooks_hardening.sql",
  ])
    await db.exec(readFileSync(`drizzle/migrations/${f}`, "utf8"));
  await db.exec(`CREATE TRIGGER documents_outbox AFTER INSERT OR UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION documents_to_outbox();
    INSERT INTO tenants VALUES ('t1');
    INSERT INTO documents (id, tenant_id, status) VALUES ('${D}','t1','draft');
    INSERT INTO document_versions VALUES ('${V}','${D}','t1','sha256:ab',12,'application/pdf');
    UPDATE documents SET current_version_id='${V}' WHERE id='${D}';
    DELETE FROM event_outbox;`);
}, 30_000);
describe("file-event trigger", () => {
  it("writes one Stored event when a file starts scanning, with ids and hash only", async () => {
    await db.exec(`UPDATE documents SET pipeline_state='scanning', pipeline_detail='{"attempt":1}' WHERE id='${D}';
      UPDATE documents SET pipeline_detail='{"attempt":1,"x":1}' WHERE id='${D}';`);
    expect(await events()).toEqual([
      {
        event_type: "DocumentFileStoredEvent",
        payload: {
          versionId: V,
          contentHash: "sha256:ab",
          sizeBytes: 12,
          mediaType: "application/pdf",
          attempt: 1,
        },
      },
    ]);
  });
  it("writes ReadyToRead on reading, and Purged with every version id", async () => {
    await db.exec(`UPDATE documents SET pipeline_state='reading', pipeline_detail='{"attempt":2}' WHERE id='${D}';
      UPDATE documents SET purged_at=now(), deleted_at=now() WHERE id='${D}';`);
    const e = await events();
    expect(e[0]).toEqual({
      event_type: "DocumentFileReadyToReadEvent",
      payload: { versionId: V, attempt: 2 },
    });
    expect(e.find((x) => x.event_type === "DocumentFilePurgedEvent")?.payload).toEqual({
      versionIds: [V],
    });
  });
  it("gives a hold change the flag only, and nothing for a no-op hold", async () => {
    await db.exec(
      `UPDATE documents SET legal_hold=true WHERE id='${D}'; UPDATE documents SET legal_hold=true WHERE id='${D}';`,
    );
    expect(await events()).toEqual([
      { event_type: "DocumentAttributeValueChangeEvent", payload: { changed: "legalHold" } },
    ]);
  });
  it("never blocks the update when attempt is malformed", async () => {
    await db.exec(
      `UPDATE documents SET pipeline_state='scanning', pipeline_detail='{"attempt":"x"}' WHERE id='${D}';`,
    );
    expect((await events())[0]?.payload["attempt"]).toBe(0);
  });
  it("keeps the earlier change events as they were", async () => {
    await db.exec(`UPDATE documents SET status='in_review' WHERE id='${D}';`);
    expect(await events()).toEqual([
      {
        event_type: "DocumentStateChangeEvent",
        payload: { lifecycleState: "in_review", previous: "draft" },
      },
    ]);
  });
  it("reports a version change made together with a hold change", async () => {
    await db.exec(`INSERT INTO document_versions VALUES ('33333333-3333-4333-8333-333333333333','${D}','t1','h2',1,'text/plain');
      UPDATE documents SET legal_hold=true, current_version_id='33333333-3333-4333-8333-333333333333' WHERE id='${D}';`);
    expect((await events()).map((e) => e.payload)).toEqual([{ changed: "legalHold" }, {}]);
  });
  it("writes no Stored event for a version of another document or tenant", async () => {
    await db.exec(`INSERT INTO document_versions VALUES ('44444444-4444-4444-8444-444444444444','99999999-9999-4999-8999-999999999999','t2','h3',1,'text/plain');
      UPDATE documents SET current_version_id='44444444-4444-4444-8444-444444444444' WHERE id='${D}';
      DELETE FROM event_outbox;
      UPDATE documents SET pipeline_state='scanning' WHERE id='${D}';`);
    expect(await events()).toEqual([]);
  });
});
