// @vitest-environment node
// No sensitive text reaches an event (file-hooks spec R1.6, R6.4; task 4.3). Every migration that
// writes events runs on a real Postgres (PGlite) against a document full of sensitive text; each
// outbox row is then turned into the body a subscriber receives. Neither may contain any of it.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eventMatches, toTmfEvent } from "@/services/tmf667-events";

const D = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444";
const SECRETS = {
  name: "Merger plan Aurora.pdf",
  description: "Board-only: acquisition of Borealis",
  holdReason: "Litigation with Borealis",
  holdReference: "CASE-7731-CONFIDENTIAL",
  value: "SEK 48,000,000",
  label: "Final draft for the board",
  note: "Signed by the CFO",
  threat: "Eicar-Test-Signature",
};
let db: PGlite;
type Row = {
  id: number;
  event_type: string;
  document_id: string;
  created_at: string;
  payload: unknown;
};
let rows: Row[] = [];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TYPE pipeline_state AS ENUM ('uploading','scanning','reading','ready','failed','quarantined');
    CREATE TABLE tenants (id text primary key);
    CREATE TABLE documents (id uuid primary key, tenant_id text, name text, description text, status text,
      deleted_at timestamptz, purged_at timestamptz, legal_hold boolean default false, hold_reason text,
      hold_reference text, hold_set_by uuid, created_by uuid, current_version_id uuid,
      characteristic jsonb default '[]', pipeline_state pipeline_state default 'uploading', pipeline_detail jsonb);
    CREATE TABLE document_versions (id uuid primary key, document_id uuid, tenant_id text, label text,
      note text, content_hash text, size_bytes bigint, mime_type text, storage_path text);
    CREATE TABLE event_outbox (id bigint generated always as identity primary key, tenant_id text,
      event_type text, document_id uuid, payload jsonb default '{}', created_at timestamptz default now());`);
  for (const f of [
    "0016_file_hooks.sql",
    "0017_file_hooks_safe_attempt.sql",
    "0018_file_hooks_hardening.sql",
    "0019_file_hooks_events_review.sql",
  ])
    await db.exec(readFileSync(`drizzle/migrations/${f}`, "utf8"));
  const s = SECRETS;
  const detail = JSON.stringify({
    attempt: 1,
    threatName: s.threat,
    by: s.name,
    reason: s.holdReason,
  });
  // The outbox trigger exactly as migration 0007 creates it.
  const outboxTrigger = /CREATE TRIGGER documents_outbox[\s\S]*?;/.exec(
    readFileSync("drizzle/migrations/0007_migration.sql", "utf8"),
  )![0];
  await db.exec(outboxTrigger);
  await db.exec(`INSERT INTO tenants VALUES ('t1');
    INSERT INTO documents (id, tenant_id, name, description, status, created_by)
      VALUES ('${D}', 't1', '${s.name}', '${s.description}', 'draft', '${PERSON}');
    INSERT INTO document_versions VALUES
      ('${V1}', '${D}', 't1', '${s.label}', '${s.note}', 'sha256:${"a".repeat(64)}', 12, 'application/pdf', 't1/${s.name}'),
      ('${V2}', '${D}', 't1', '${s.label} 2', '${s.note}', 'sha256:${"b".repeat(64)}', 13, 'application/pdf', 't1/v2');
    UPDATE documents SET current_version_id = '${V1}' WHERE id = '${D}';
    UPDATE documents SET pipeline_state = 'scanning', pipeline_detail = '${detail}' WHERE id = '${D}';
    UPDATE documents SET pipeline_state = 'reading' WHERE id = '${D}';
    UPDATE documents SET pipeline_state = 'ready',
      characteristic = '[{"name":"amount","value":"${s.value}"}]' WHERE id = '${D}';
    UPDATE documents SET legal_hold = true, hold_reason = '${s.holdReason}',
      hold_reference = '${s.holdReference}', hold_set_by = '${PERSON}', status = 'in_review' WHERE id = '${D}';
    UPDATE documents SET current_version_id = '${V2}', pipeline_state = 'uploading' WHERE id = '${D}';
    UPDATE documents SET pipeline_state = 'scanning' WHERE id = '${D}';
    UPDATE documents SET pipeline_state = 'quarantined' WHERE id = '${D}';
    UPDATE documents SET legal_hold = false, hold_reason = NULL WHERE id = '${D}';
    UPDATE documents SET deleted_at = now() WHERE id = '${D}';
    UPDATE documents SET purged_at = now(), description = NULL, characteristic = '[]' WHERE id = '${D}';`);
  rows = (
    await db.query<Row>(
      "select id::int as id, event_type, document_id::text, created_at::text, payload from event_outbox order by id",
    )
  ).rows;
}, 30_000);

const leaks = (text: string) =>
  [...Object.values(SECRETS), PERSON, "Borealis", "board", "CFO"].filter((s) =>
    text.toLowerCase().includes(s.toLowerCase()),
  );

describe("events never carry document content", () => {
  it("every kind of event was written", () => {
    expect(new Set(rows.map((r) => r.event_type))).toEqual(
      new Set([
        "DocumentCreateEvent",
        "DocumentFileStoredEvent",
        "DocumentFileReadyToReadEvent",
        "DocumentAttributeValueChangeEvent",
        "DocumentStateChangeEvent",
        "DocumentDeleteEvent",
        "DocumentFilePurgedEvent",
      ]),
    );
  });
  it("no outbox row holds names, descriptions, hold reasons, values, labels, notes, paths, threats or people", () => {
    for (const r of rows) expect(leaks(JSON.stringify(r.payload)), r.event_type).toEqual([]);
  });
  it("no delivered body holds them either, whatever the subscription asks for", () => {
    const queries = [
      null,
      "eventType=DocumentFileStoredEvent,DocumentFileReadyToReadEvent,DocumentFilePurgedEvent",
      "eventType=DocumentStateChangeEvent,DocumentAttributeValueChangeEvent",
    ];
    let delivered = 0;
    for (const q of queries)
      for (const r of rows) {
        if (!eventMatches(q, r.event_type)) continue;
        delivered++;
        const body = JSON.stringify(toTmfEvent("https://app.example.test", r, q));
        expect(leaks(body), `${r.event_type} for ${String(q)}`).toEqual([]);
      }
    expect(delivered).toBeGreaterThan(rows.length);
  });
  it("the file events carry their ids and facts, and the hold change names only the attribute", () => {
    const stored = rows.find((r) => r.event_type === "DocumentFileStoredEvent")!;
    expect(toTmfEvent("https://x.test", stored).event).toMatchObject({
      file: { versionId: V1, sizeBytes: 12, mediaType: "application/pdf", attempt: 1 },
    });
    const purged = rows.find((r) => r.event_type === "DocumentFilePurgedEvent")!;
    expect(toTmfEvent("https://x.test", purged).event).toMatchObject({
      file: { versionIds: expect.arrayContaining([V1, V2]) },
    });
    const holds = rows.filter(
      (r) => JSON.stringify(r.payload) === JSON.stringify({ changed: "legalHold" }),
    );
    expect(holds).toHaveLength(2);
  });
  it("the delivered body drops content even if a payload ever held it (each layer on its own)", () => {
    const poison = {
      ...Object.fromEntries(Object.entries(SECRETS).map(([k, v]) => [k, v])),
      reason: SECRETS.holdReason,
      versionId: V1,
      versionIds: [V1],
      attempt: 1,
      changed: "legalHold",
      lifecycleState: "draft",
      documentIds: [D],
    };
    for (const event_type of [...new Set(rows.map((r) => r.event_type)), "DocumentBatchEvent"]) {
      const body = JSON.stringify(
        toTmfEvent("https://x.test", {
          id: 1,
          event_type,
          document_id: D,
          created_at: "t",
          payload: poison,
        }),
      );
      expect(leaks(body), event_type).toEqual([]);
    }
  });
});
