// @vitest-environment node
// QA adversarial pass on migrations 0016-0018, run on PGlite (a real Postgres): what the trigger really
// writes, and whether the TypeScript side (`storedAttemptText`, `readDetail`, `fileEventPayload`) agrees
// with what Postgres does with the same jsonb. `it.fails` = asserts the correct behaviour, fails today.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { readDetail, storedAttemptText } from "@/services/file-hook-detail";
import { fileEventPayload, isFileEvent } from "@/services/file-hook-rules";

const D = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const V_OTHER = "44444444-4444-4444-8444-444444444444";
const HASH = `sha256:${"ab".repeat(32)}`;
const MIGRATIONS = [
  "0016_file_hooks.sql",
  "0017_file_hooks_safe_attempt.sql",
  "0018_file_hooks_hardening.sql",
];
let db: PGlite;
type Ev = { event_type: string; payload: Record<string, unknown> };
const events = async () =>
  (await db.query<Ev>("select event_type, payload from event_outbox order by id")).rows;
const clear = () => db.exec("DELETE FROM event_outbox");
/** Events written by one statement. */
async function run(sql: string) {
  await clear();
  await db.exec(sql);
  return events();
}
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
  for (const f of MIGRATIONS) await db.exec(readFileSync(`drizzle/migrations/${f}`, "utf8"));
  await db.exec(`CREATE TRIGGER documents_outbox AFTER INSERT OR UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION documents_to_outbox();
    INSERT INTO tenants VALUES ('t1'), ('t2');
    INSERT INTO documents (id, tenant_id, status) VALUES ('${D}','t1','draft');
    INSERT INTO document_versions VALUES ('${V}','${D}','t1','${HASH}',12,'application/pdf');
    INSERT INTO document_versions VALUES ('${V_OTHER}','99999999-9999-4999-8999-999999999999','t2','h',1,'text/plain');
    UPDATE documents SET current_version_id='${V}' WHERE id='${D}';
    DELETE FROM event_outbox;`);
}, 30_000);

describe("QA migrations: shape and re-application", () => {
  it("re-applying 0016-0018 changes nothing: one file-event trigger, same behaviour", async () => {
    for (const f of MIGRATIONS) await db.exec(readFileSync(`drizzle/migrations/${f}`, "utf8"));
    const n = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_trigger where tgname = 'documents_file_events' and not tgisinternal",
    );
    expect(n.rows[0]!.n).toBe(1);
    const e = await run(
      `UPDATE documents SET pipeline_state='scanning', pipeline_detail='{"attempt":1}' WHERE id='${D}'`,
    );
    expect(e.map((x) => x.event_type)).toEqual(["DocumentFileStoredEvent"]);
  });
  it("the switch column is a non-null object defaulting to {}", async () => {
    const r = await db.query<{ external_processing: unknown }>(
      "select external_processing from tenants where id='t1'",
    );
    expect(r.rows[0]!.external_processing).toEqual({});
    await expect(
      db.exec("UPDATE tenants SET external_processing = NULL WHERE id='t1'"),
    ).rejects.toThrow();
  });
  it("neither definer function can be called by anon, authenticated or PUBLIC, and both pin an empty search_path", async () => {
    for (const fn of ["public.documents_file_events()", "public.documents_to_outbox()"]) {
      for (const role of ["anon", "authenticated"]) {
        const r = await db.query<{ ok: boolean }>(
          `select has_function_privilege('${role}', '${fn}', 'execute') as ok`,
        );
        expect(r.rows[0]!.ok, `${role} ${fn}`).toBe(false);
      }
      const cfg = await db.query<{ proconfig: string[] | null }>(
        `select proconfig from pg_proc where oid = '${fn}'::regprocedure`,
      );
      expect(cfg.rows[0]!.proconfig?.join(",")).toMatch(/search_path=("")?$/);
    }
  });
});

describe("QA trigger: when events are written", () => {
  it("writes an event for every ENTRY into scanning or reading, including Try again, and none for a repeat", async () => {
    const seq: [string, string | null][] = [
      ["scanning", "DocumentFileStoredEvent"],
      ["scanning", null], // same state again
      ["reading", "DocumentFileReadyToReadEvent"],
      ["failed", null],
      ["reading", "DocumentFileReadyToReadEvent"], // Try again after a read failure
      ["ready", null],
      ["uploading", null], // new version
      ["scanning", "DocumentFileStoredEvent"],
      ["quarantined", null],
    ];
    for (const [state, expected] of seq) {
      const e = await run(
        `UPDATE documents SET pipeline_state='${state}', pipeline_detail='{"attempt":1}' WHERE id='${D}'`,
      );
      expect(
        e.map((x) => x.event_type),
        state,
      ).toEqual(expected ? [expected] : []);
    }
  });
  it("writes both a state event and the purge event when one update does both", async () => {
    const e = await run(
      `UPDATE documents SET pipeline_state='scanning', purged_at=now() WHERE id='${D}'`,
    );
    expect(e.map((x) => x.event_type).sort()).toEqual([
      "DocumentFilePurgedEvent",
      "DocumentFileStoredEvent",
    ]);
  });
  it("purge: an empty list for a document with no versions, nothing for a second purge, only this tenant's versions", async () => {
    await db.exec(
      `DELETE FROM document_versions WHERE id='${V}'; INSERT INTO document_versions VALUES ('55555555-5555-4555-8555-555555555555','${D}','t2','h',1,'a/b')`,
    );
    const e = await run(`UPDATE documents SET purged_at=now() WHERE id='${D}'`);
    expect(e).toEqual([{ event_type: "DocumentFilePurgedEvent", payload: { versionIds: [] } }]);
    expect(
      await run(`UPDATE documents SET purged_at=now() + interval '1 hour' WHERE id='${D}'`),
    ).toEqual([]);
  });
  it("an update that touches neither column writes no file event", async () => {
    expect(await run(`UPDATE documents SET characteristic='[1]' WHERE id='${D}'`)).toEqual([
      { event_type: "DocumentAttributeValueChangeEvent", payload: {} },
    ]);
  });
  // DEFECT (low-medium, 0018 documents_to_outbox): the hold branch sits inside `ELSE` of the
  // status / delete chain, so an update that changes the status AND the hold writes only the status
  // event. R1.3 says a hold that actually changes SHALL name legalHold; this one never does.
  it.fails(
    "names legalHold when the hold and the status change in one update (BUG: hold event lost)",
    async () => {
      const e = await run(
        `UPDATE documents SET status='in_review', legal_hold=true WHERE id='${D}'`,
      );
      expect(e.map((x) => x.payload)).toContainEqual({ changed: "legalHold" });
    },
  );
  it("a hold released names legalHold too, with no value", async () => {
    await db.exec(`UPDATE documents SET legal_hold=true WHERE id='${D}'`);
    expect(await run(`UPDATE documents SET legal_hold=false WHERE id='${D}'`)).toEqual([
      { event_type: "DocumentAttributeValueChangeEvent", payload: { changed: "legalHold" } },
    ]);
  });
  // DEFECT (low, 0016-0018 ReadyToRead branch): unlike Stored, the ReadyToRead event is not tied to a
  // version of THIS document and tenant (0018 added that only to Stored). With no current version the
  // event is written with versionId null (the whitelist then drops it: a subscriber gets
  // { attempt } and no version to fetch); with another tenant's version it names a foreign id.
  it.fails(
    "writes no ReadyToRead event when the document has no current version (BUG: event with null versionId)",
    async () => {
      await db.exec(`UPDATE documents SET current_version_id=NULL WHERE id='${D}'`);
      expect(await run(`UPDATE documents SET pipeline_state='reading' WHERE id='${D}'`)).toEqual(
        [],
      );
    },
  );
  it.fails(
    "never names another tenant's version in a ReadyToRead event (BUG: unchecked current_version_id)",
    async () => {
      await db.exec(`UPDATE documents SET current_version_id='${V_OTHER}' WHERE id='${D}'`);
      const e = await run(`UPDATE documents SET pipeline_state='reading' WHERE id='${D}'`);
      expect(JSON.stringify(e)).not.toContain(V_OTHER);
    },
  );
});

describe("QA trigger payloads meet the TypeScript whitelist (contract between SQL and fileEventPayload)", () => {
  it("no key the trigger writes for normal data is dropped by the whitelist", async () => {
    await db.exec(
      `UPDATE document_versions SET mime_type='application/vnd.openxmlformats-officedocument.presentationml.presentation', size_bytes=26214400 WHERE id='${V}'`,
    );
    const all = [
      ...(await run(
        `UPDATE documents SET pipeline_state='scanning', pipeline_detail='{"attempt":1}' WHERE id='${D}'`,
      )),
      ...(await run(
        `UPDATE documents SET pipeline_state='reading', pipeline_detail='{"attempt":2}' WHERE id='${D}'`,
      )),
      ...(await run(`UPDATE documents SET purged_at=now() WHERE id='${D}'`)),
    ];
    expect(all).toHaveLength(3);
    for (const e of all) {
      expect(isFileEvent(e.event_type)).toBe(true);
      if (!isFileEvent(e.event_type)) continue;
      expect(fileEventPayload(e.event_type, e.payload), e.event_type).toEqual(e.payload);
    }
  });
  it("pinned: a version with an empty hash, no size or a media type with parameters loses those keys in the delivered event", async () => {
    await db.exec(
      `UPDATE document_versions SET content_hash='', size_bytes=NULL, mime_type='text/plain; charset=utf-8' WHERE id='${V}'`,
    );
    const [e] = await run(
      `UPDATE documents SET pipeline_state='scanning', pipeline_detail='{"attempt":1}' WHERE id='${D}'`,
    );
    expect(e!.payload).toMatchObject({
      contentHash: "",
      sizeBytes: null,
      mediaType: "text/plain; charset=utf-8",
    });
    expect(fileEventPayload("DocumentFileStoredEvent", e!.payload)).toEqual({
      versionId: V,
      attempt: 1,
    });
  });
  it("an event carries nothing but whitelisted keys even when the document row holds sensitive columns", async () => {
    await db.exec(`ALTER TABLE documents ADD COLUMN name text, ADD COLUMN hold_reason text;
      UPDATE documents SET name='Secret plan.pdf', hold_reason='dispute' WHERE id='${D}'; DELETE FROM event_outbox;`);
    const e = await run(
      `UPDATE documents SET pipeline_state='scanning', legal_hold=true, pipeline_detail='{"attempt":1,"secret":"x"}' WHERE id='${D}'`,
    );
    const text = JSON.stringify(e);
    for (const s of ["Secret plan", "dispute", "secret"]) expect(text).not.toContain(s);
  });
});

// A literal as it would be written inside the jsonb document.
const LITERALS = [
  "3",
  "0",
  "-0",
  "-1",
  "999999999",
  "1000000000",
  "100",
  '"03"',
  '"3"',
  '""',
  '"x"',
  '" 3"',
  '"null"',
  "3.0",
  "0.0",
  "1e2",
  "1.5",
  "true",
  "null",
  "[3]",
  '{"a":1}',
  "9007199254740993",
  "1e21",
  "100000000000000000000",
];
async function pgText(lit: string): Promise<string | null> {
  const r = await db.query<{ t: string | null }>(
    `select ('{"attempt":${lit}}'::jsonb ->> 'attempt') as t`,
  );
  return r.rows[0]!.t;
}
describe("QA jsonb text guard against real Postgres", () => {
  it("storedAttemptText equals Postgres's `->>'attempt'` for every guardable literal that round-trips", async () => {
    for (const lit of [
      "3",
      "0",
      "-0",
      "-1",
      "999999999",
      "1000000000",
      "100",
      '"03"',
      '"3"',
      '""',
      '"x"',
      '" 3"',
      '"null"',
      "1e2",
      "null",
    ]) {
      const raw = JSON.parse(`{"attempt":${lit}}`);
      expect(storedAttemptText(raw), lit).toBe(await pgText(lit));
    }
  });
  it("a literal the text cannot represent is refused (undefined), never guessed", async () => {
    for (const lit of [
      "1.5",
      "true",
      "[3]",
      '{"a":1}',
      "9007199254740993",
      "1e21",
      "100000000000000000000",
    ])
      expect(storedAttemptText(JSON.parse(`{"attempt":${lit}}`)), lit).toBeUndefined();
  });
  // DEFECT (low, file-hook-detail.ts:113): jsonb keeps the scale of a number, so `{"attempt":3.0}` reads
  // back as the text "3.0" in Postgres while JSON.parse in JS gives 3 and the guard text is "3". The
  // guarded UPDATE then compares '3.0' = '3': it never matches, `updateDocumentIf` reports a conflict
  // forever and the document cannot advance, retry, time out or take a new version (a stuck row, not a
  // wrong write). Reachable only when something other than this code (a script, a manual fix) wrote 3.0.
  it.fails(
    "the guard text for {attempt: 3.0} matches Postgres (BUG: '3' vs '3.0', row can never be written)",
    async () => {
      const bad: string[] = [];
      for (const lit of ["3.0", "0.0", "1.00"]) {
        const t = storedAttemptText(JSON.parse(`{"attempt":${lit}}`));
        if (t !== undefined && t !== (await pgText(lit)))
          bad.push(`${lit}: js=${t} pg=${await pgText(lit)}`);
      }
      expect(bad).toEqual([]);
    },
  );
  it("proves the stuck row on a real UPDATE: guard '3' matches no row when the stored text is '3.0'", async () => {
    await db.exec(
      `UPDATE documents SET pipeline_state='scanning', pipeline_detail='{"attempt":3.0}' WHERE id='${D}'`,
    );
    const guard = storedAttemptText({ attempt: 3.0 });
    const r = await db.query(
      `UPDATE documents SET pipeline_state='reading' WHERE id=$1 AND pipeline_state='scanning' AND pipeline_detail->>'attempt' = $2 RETURNING id`,
      [D, guard],
    );
    expect(r.rows).toHaveLength(0); // pinned: this is the stuck-row mechanism
  });
  it("a missing or null attempt is guarded with IS NULL and matches", async () => {
    for (const detail of ["'{}'", "'{\"attempt\":null}'", "NULL", "'\"scalar\"'", "'[1]'"]) {
      await db.exec(
        `UPDATE documents SET pipeline_state='scanning', pipeline_detail=${detail} WHERE id='${D}'`,
      );
      const r = await db.query(
        `UPDATE documents SET pipeline_state='scanning' WHERE id=$1 AND pipeline_detail->>'attempt' IS NULL RETURNING id`,
        [D],
      );
      expect(r.rows, detail).toHaveLength(1);
    }
  });
});

describe("QA trigger attempt vs the TypeScript reading of the same jsonb", () => {
  async function triggerAttempt(lit: string): Promise<number> {
    await db.exec(
      `UPDATE documents SET pipeline_state='uploading', pipeline_detail=NULL WHERE id='${D}'`,
    );
    const e = await run(
      `UPDATE documents SET pipeline_state='scanning', pipeline_detail='{"attempt":${lit}}' WHERE id='${D}'`,
    );
    return e[0]!.payload["attempt"] as number;
  }
  it("a malformed attempt never blocks the update and counts as 0", async () => {
    for (const lit of [
      '"x"',
      '" 3"',
      "-1",
      "1000000000",
      "true",
      "null",
      "[3]",
      '{"a":1}',
      "1.5",
      '""',
    ])
      expect(await triggerAttempt(lit), lit).toBe(0);
  });
  it("well-formed attempts come through: 0, 3, 999999999, 1e2", async () => {
    expect(await triggerAttempt("0")).toBe(0);
    expect(await triggerAttempt("3")).toBe(3);
    expect(await triggerAttempt("999999999")).toBe(999999999);
    expect(await triggerAttempt("1e2")).toBe(100);
  });
  // DEFECT (low): the SQL and the TypeScript disagree about what the attempt IS for two stored shapes.
  // '"03"' (text): trigger event says 3, readDetail says 0. {"attempt":3.0}: trigger says 0 ('3.0' fails
  // the digit pattern), readDetail says 3. The event a scanner receives and the attempt the server will
  // accept back then differ, so the scanner's answer is refused as stale. Only hand-written rows.
  it.fails(
    "the trigger's attempt equals readDetail's attempt for the same stored value (BUG: '03' and 3.0)",
    async () => {
      const diffs: string[] = [];
      for (const lit of ["3", '"03"', "3.0", "0.0", '"3"', "-0"]) {
        const sql = await triggerAttempt(lit);
        const ts = readDetail(JSON.parse(`{"attempt":${lit}}`)).attempt + 0;
        if (sql !== ts) diffs.push(`${lit}: trigger=${sql} readDetail=${ts}`);
      }
      expect(diffs).toEqual([]);
    },
  );
  it("covers every literal without throwing in Postgres (the trigger never aborts an update)", async () => {
    for (const lit of LITERALS)
      await expect(triggerAttempt(lit), lit).resolves.toBeTypeOf("number");
  });
});
