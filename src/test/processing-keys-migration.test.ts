// @vitest-environment node
// Migration 0020 on PGlite: a processing key has one scope (D4) and an organisation has at most one
// that is not disconnected (D3), even when two are created at once; the switch has a valid shape and
// changes to it are atomic and recorded.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
let n = 0;
const add = (tenant: string, scopes: string, revoked = "NULL") =>
  db.exec(`INSERT INTO integration_clients (tenant_id, key_hash, scopes, revoked_at)
    VALUES ('${tenant}', 'h${++n}', '${scopes}', ${revoked})`);
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE tenants (id text primary key, external_processing jsonb NOT NULL DEFAULT '{}'::jsonb);
    INSERT INTO tenants VALUES ('t1', '{}'), ('t2', '{}');
    CREATE TABLE document_events (id bigint generated always as identity primary key, tenant_id text not null,
      document_id uuid, version_id uuid, actor uuid, action text not null, detail text,
      created_at timestamptz not null default now());
    CREATE TABLE integration_clients (id serial primary key, tenant_id text not null,
    key_hash text not null unique, scopes text[] not null default '{read}', revoked_at timestamptz);`);
  await db.exec(readFileSync("drizzle/migrations/0020_processing_keys.sql", "utf8"));
}, 30_000);

describe("processing keys in the database", () => {
  it("allows ordinary keys with any scopes", async () => {
    await add("t1", "{read,register}");
    await add("t1", "{read,register}");
  });
  it.each(["{scan,read}", "{extract,subscribe}", "{scan,extract}"])(
    "refuses a processing scope with another scope: %s",
    async (scopes) => {
      await expect(add("t1", scopes)).rejects.toThrow(/processing_scope_alone/);
    },
  );
  it("refuses a second scanner in one organisation, but not in another or after disconnecting", async () => {
    await add("t1", "{scan}");
    await expect(add("t1", "{scan}")).rejects.toThrow(/one_processing_key/);
    await add("t2", "{scan}");
    await add("t1", "{extract}");
    await add("t1", "{scan}", "now()"); // a disconnected one never counts
    await db.exec(
      "UPDATE integration_clients SET revoked_at = now() WHERE tenant_id='t1' AND scopes='{scan}'",
    );
    await add("t1", "{scan}");
  });
});
const A = "00000000-0000-4000-8000-000000000001";
const sw = async () =>
  (await db.query<{ e: unknown }>("select external_processing as e from tenants where id='t1'"))
    .rows[0]!.e;
const set = async (patch: string) =>
  (
    await db.query<{ r: unknown }>(
      `select public.set_external_processing('t1', '${A}', '${patch}'::jsonb) as r`,
    )
  ).rows[0]!.r;
const audits = async () =>
  (await db.query<{ detail: string }>("select detail from document_events order by id")).rows.map(
    (r) => r.detail,
  );

describe("the organisation switch in the database", () => {
  it.each(['{"scan":"true"}', '{"read":1}', '{"scan":null}', "[]", '"on"'])(
    "refuses a value that is not a switch: %s",
    async (v) => {
      await expect(
        db.exec(`UPDATE tenants SET external_processing='${v}' WHERE id='t1'`),
      ).rejects.toThrow();
    },
  );
  it("changes only the named step, so two changes one after the other both stay", async () => {
    await set('{"scan":true}');
    await set('{"read":true}');
    expect(await sw()).toEqual({ scan: true, read: true });
    expect(await audits()).toEqual([
      "externalProcessing.scan: off to on",
      "externalProcessing.read: off to on",
    ]);
  });
  it("records nothing for a change to nothing, and leaves other organisations alone", async () => {
    await set('{"scan":false}');
    expect(await audits()).toEqual([]);
    await set('{"scan":true}');
    const other = await db.query<{ e: unknown }>(
      "select external_processing as e from tenants where id='t2'",
    );
    expect(other.rows[0]!.e).toEqual({});
  });
  it.each(['{"scan":"yes"}', "[1]", '{"scan":null}'])(
    "refuses a patch that is not true or false: %s",
    async (p) => {
      await expect(set(p)).rejects.toThrow();
      expect(await sw()).toEqual({});
      expect(await audits()).toEqual([]);
    },
  );
  it("ignores keys other than scan and read", async () => {
    await set('{"scan":true,"evil":"x"}');
    expect(await sw()).toEqual({ scan: true });
  });
  it("can be called by the server only", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>(
        `select has_function_privilege('${role}', 'public.set_external_processing(text, uuid, jsonb)', 'execute') as ok`,
      );
      expect(r.rows[0]!.ok, role).toBe(false);
    }
  });
});
