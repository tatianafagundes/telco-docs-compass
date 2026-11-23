// @vitest-environment node
// Migration 0020 on PGlite: a processing key has one scope (D4) and an organisation has at most one
// that is not disconnected (D3), even when two are created at once.
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
  await db.exec(`CREATE TABLE integration_clients (id serial primary key, tenant_id text not null,
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
