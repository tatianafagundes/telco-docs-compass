// File hooks phase 3: the organisation switch (D1), the organisation's own antivirus and reader keys
// (D3, D4) and who handles a step that starts now.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  activeProcessingKeys,
  loadSwitch,
  parseSwitch,
  resolveOwners,
  setSwitchStep,
} from "@/services/external-processing";
import { createSystemStep } from "@/services/integration-client-create";
import { sha256Bytes } from "@/services/gateway-create-input";
import { advanceStep, type StepDeps } from "@/services/pipeline-step";
import { isActiveKey, processingScope, scopesAllowed } from "@/services/processing-keys";
import type { WriteEnv } from "@/services/seam-runtime";
import { DatabaseError } from "@/services/shared/must";
import { FakeDb, type Row } from "@/test/fake-db";

const NOW = new Date("2026-11-24T10:00:00Z");
const key = (over: Partial<Row> = {}): Row => ({
  id: "k1",
  tenant_id: "t1",
  name: "Acme AV",
  scopes: ["scan"],
  revoked_at: null,
  expires_at: null,
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});
const envOf = (admin: FakeDb, role = "tenant_admin") =>
  ({ admin: admin.asDb(), caller: admin.asDb(), userId: "u1", tenantId: "t1", role }) as WriteEnv;

describe("processing scopes (D4)", () => {
  it.each([
    [["scan"], true],
    [["extract"], true],
    [["read", "register"], true],
    [["scan", "scan"], true],
    [["scan", "read"], false],
    [["extract", "subscribe"], false],
    [["scan", "extract"], false],
  ])("%j allowed: %s", (scopes, ok) => expect(scopesAllowed(scopes)).toBe(ok));
  it("names the processing scope of a key", () => {
    expect(processingScope(["read", "scan"])).toBe("scan");
    expect(processingScope(["read"])).toBeNull();
  });
  it("an expired or disconnected key is not active", () => {
    expect(isActiveKey({ revoked_at: null, expires_at: null }, NOW)).toBe(true);
    expect(isActiveKey({ revoked_at: null, expires_at: NOW.toISOString() }, NOW)).toBe(false);
    expect(isActiveKey({ revoked_at: "2026-11-01T00:00:00Z", expires_at: null }, NOW)).toBe(false);
  });
});

describe("the organisation switch (D1)", () => {
  it.each([
    [
      { scan: true, read: true },
      { scan: true, read: true },
    ],
    [{}, { scan: false, read: false }],
    [{ scan: false }, { scan: false, read: false }],
    [JSON.parse('{"__proto__":{"scan":true}}'), { scan: false, read: false }],
    // Not a switch: refused, never read as "off" (built-in simulated check).
    [{ scan: "true" }, null],
    [{ read: 1 }, null],
    [{ scan: null }, null],
    [null, null],
    [[true], null],
  ])("%j reads as %j", (raw, want) => expect(parseSwitch(raw)).toEqual(want));
  it("a stored value that is not a switch stops the step", async () => {
    const db = new FakeDb({ tenants: [{ id: "t1", external_processing: { scan: "yes" } }] });
    await expect(loadSwitch(db.asDb(), "t1")).rejects.toThrow(DatabaseError);
  });
  it("is off where the column does not exist yet, and stops the step on any other failure", async () => {
    const missing = new FakeDb({ tenants: [] });
    const db = missing.asDb() as unknown as { from: (t: string) => unknown };
    const answer = (error: { code: string; message: string }) => {
      db.from = () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error }) }) }),
      });
    };
    answer({ code: "42703", message: "column does not exist" });
    expect(await loadSwitch(missing.asDb(), "t1")).toEqual({ scan: false, read: false });
    answer({ code: "57014", message: "timeout" });
    await expect(loadSwitch(missing.asDb(), "t1")).rejects.toThrow(DatabaseError);
    await expect(loadSwitch(new FakeDb({ tenants: [] }).asDb(), "t1")).rejects.toThrow(
      DatabaseError,
    );
  });
});

describe("who handles a step", () => {
  const world = (sw: unknown, keys: Row[] = []) =>
    new FakeDb({
      tenants: [{ id: "t1", external_processing: sw }],
      integration_clients: keys,
    }).asDb();
  it("switch off: simulated, whatever keys exist", async () => {
    expect(await resolveOwners(world({}, [key()]), "t1", NOW)).toEqual({
      scan: { mode: "simulated" },
      read: { mode: "simulated" },
    });
  });
  it("switch on: the organisation's active key for each step", async () => {
    const owners = await resolveOwners(
      world({ scan: true, read: true }, [
        key(),
        key({ id: "k2", name: "Acme OCR", scopes: ["extract"] }),
      ]),
      "t1",
      NOW,
    );
    expect(owners).toEqual({
      scan: { mode: "external", by: "Acme AV", byClient: "k1" },
      read: { mode: "external", by: "Acme OCR", byClient: "k2" },
    });
  });
  it.each([
    ["no key", []],
    ["a disconnected key", [key({ revoked_at: "2026-11-02T00:00:00Z" })]],
    ["an expired key", [key({ expires_at: "2026-11-02T00:00:00Z" })]],
    ["another organisation's key", [key({ tenant_id: "t2" })]],
    ["a key that also has other scopes", [key({ scopes: ["scan", "read"] })]],
    ["two active keys", [key(), key({ id: "k2" })]],
  ])("switch on with %s: the step waits for nobody, never simulated", async (_n, keys) => {
    const owners = await resolveOwners(world({ scan: true }, keys), "t1", NOW);
    expect(owners.scan).toEqual({ mode: "external", by: null, byClient: null });
    expect(owners.read).toEqual({ mode: "simulated" });
  });
  it("a failed lookup of the keys stops the step", async () => {
    const db = new FakeDb({
      tenants: [{ id: "t1", external_processing: { scan: true } }],
      integration_clients: [],
    }).fail("integration_clients", "select");
    await expect(resolveOwners(db.asDb(), "t1", NOW)).rejects.toThrow(DatabaseError);
    await expect(activeProcessingKeys(db.asDb(), "t1", "scan", NOW)).rejects.toThrow(DatabaseError);
  });
  it("an upload confirmed with the switch on waits for the organisation's antivirus", async () => {
    const bytes = new TextEncoder().encode("%PDF clean") as Uint8Array<ArrayBuffer>;
    const D = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const V = "11111111-1111-4111-8111-111111111111";
    const admin = new FakeDb({
      tenants: [{ id: "t1", external_processing: { scan: true } }],
      integration_clients: [key()],
      documents: [
        {
          id: D,
          tenant_id: "t1",
          name: "Report.pdf",
          pipeline_state: "uploading",
          pipeline_detail: null,
          current_version_id: V,
          created_by: "u1",
          deleted_at: null,
        },
      ],
      document_versions: [
        {
          id: V,
          document_id: D,
          tenant_id: "t1",
          storage_path: "t1/v",
          content_hash: `sha256:${await sha256Bytes(bytes)}`,
          size_bytes: bytes.byteLength,
        },
      ],
      document_events: [],
    });
    const deps: StepDeps = {
      download: async () => bytes,
      now: () => NOW.toISOString(),
      owners: () => resolveOwners(admin.asDb(), "t1", NOW),
    };
    const env = envOf(admin, "contributor");
    expect(await advanceStep(env, { id: D }, deps)).toMatchObject({
      ok: true,
      data: { state: "scanning", waiting: true },
    });
    expect(admin.rows("documents")[0]!["pipeline_detail"]).toMatchObject({
      mode: "external",
      by: "Acme AV",
      byClient: "k1",
      step: "scan",
    });
    // The browser's next call does not scan it.
    expect(await advanceStep(env, { id: D }, deps)).toMatchObject({
      ok: true,
      data: { state: "scanning", waiting: true },
    });
  });
});

describe("turning the switch on or off", () => {
  const db = (answer: unknown = { scan: true, read: false }) => {
    const calls: unknown[] = [];
    const admin = new FakeDb({ tenants: [{ id: "t1", external_processing: {} }] }).onRpc(
      "set_external_processing",
      (args: Record<string, unknown>) => {
        calls.push(args);
        return answer;
      },
    );
    return { admin, calls };
  };
  it("organisation administrators only", async () => {
    for (const role of ["manager", "master_admin", "contributor"]) {
      const { admin, calls } = db();
      const r = await setSwitchStep(envOf(admin, role), { scan: true });
      expect(r.ok, role).toBe(false);
      expect(calls).toEqual([]);
    }
  });
  it("sends only the named steps, as one database call that changes and records them", async () => {
    const { admin, calls } = db();
    expect(await setSwitchStep(envOf(admin), { scan: true })).toEqual({
      ok: true,
      data: { scan: true, read: false },
    });
    expect(calls).toEqual([{ p_tenant: "t1", p_actor: "u1", p_patch: { scan: true } }]);
    expect(admin.writes).toEqual([]);
  });
  it("a database answer that is not a switch is an error, not a success", async () => {
    const { admin } = db({ scan: "on" });
    await expect(setSwitchStep(envOf(admin), { scan: true })).rejects.toThrow(DatabaseError);
  });
});

describe("connecting a system (D3, D4, R6.2)", () => {
  const issued = { prefix: "erad_abcde", hash: "h-new", expiresAt: "2027-11-24T10:00:00Z" };
  const world = (keys: Row[] = []) =>
    new FakeDb({ integration_clients: keys, document_events: [] }).withAutoId(
      "integration_clients",
    );
  const create = (admin: FakeDb, scopes: string[], role = "tenant_admin") =>
    createSystemStep(
      envOf(admin, role),
      { name: "Acme AV", systemKind: "other", scopes },
      issued,
      "id, name, scopes",
    );
  it("refuses a processing scope combined with others, and writes nothing", async () => {
    const admin = world();
    const r = await create(admin, ["scan", "read"]);
    expect(!r.ok && r.error.code).toBe("system.scopesExclusive");
    expect(admin.writes).toEqual([]);
  });
  it("refuses a second scanner while one is connected, even an expired one", async () => {
    for (const existing of [key(), key({ expires_at: "2026-01-01T00:00:00Z" })]) {
      const admin = world([existing]);
      const r = await create(admin, ["scan"]);
      expect(!r.ok && r.error.code).toBe("system.processingKeyExists");
      expect(admin.writesTo("integration_clients")).toEqual([]);
    }
  });
  it("allows a scanner when the other one is disconnected, belongs to another organisation, or reads", async () => {
    for (const existing of [
      key({ revoked_at: "2026-11-02T00:00:00Z" }),
      key({ tenant_id: "t2" }),
      key({ scopes: ["extract"] }),
    ]) {
      const admin = world([existing]);
      expect((await create(admin, ["scan"])).ok).toBe(true);
    }
  });
  it("records every new key by name and scopes, never the key", async () => {
    const admin = world();
    expect((await create(admin, ["read", "register"])).ok).toBe(true);
    expect(admin.rows("document_events")).toMatchObject([
      { action: "systemConnected", detail: "Acme AV: read, register", document_id: null },
    ]);
    expect(JSON.stringify(admin.rows("document_events"))).not.toMatch(/erad_|h-new/);
  });
  it("the database's own refusal of a second key reads as the same answer", async () => {
    const admin = world();
    const db = admin.asDb() as unknown as { from: (t: string) => Record<string, unknown> };
    const real = db.from.bind(db);
    db.from = (t: string) => {
      const q = real(t) as Record<string, unknown> & { insert?: unknown };
      if (t === "integration_clients" && q.insert)
        q.insert = () => ({
          select: () => ({
            single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }),
          }),
        });
      return q;
    };
    const r = await create(admin, ["scan"]);
    expect(!r.ok && r.error.code).toBe("system.processingKeyExists");
  });
  it("a key that cannot be recorded is taken back, so it holds no slot and is never shown", async () => {
    const admin = world().fail("document_events", "insert");
    await expect(create(admin, ["scan"])).rejects.toThrow();
    expect(admin.rows("integration_clients")).toHaveLength(1);
    expect(admin.rows("integration_clients")[0]!["revoked_at"]).toBeTruthy();
  });
  it("when the key cannot be taken back either, the log says so (never the key)", async () => {
    const admin = world().fail("document_events", "insert");
    const real = admin.from.bind(admin);
    admin.from = ((t: string) => {
      const q = real(t);
      if (t === "integration_clients" && admin.rows("integration_clients").length > 0)
        admin.fail("integration_clients", "update");
      return q;
    }) as typeof admin.from;
    const logged: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((m: unknown) => void logged.push(String(m)));
    await expect(create(admin, ["read"])).rejects.toThrow();
    spy.mockRestore();
    expect(logged.join("\n")).toContain("revokeUnrecordedKey");
    expect(logged.join("\n")).not.toMatch(/erad_|h-new/);
  });
  it("records the system name with unsafe characters replaced", async () => {
    const admin = world();
    await createSystemStep(
      envOf(admin),
      { name: "Acme\u202E AV", systemKind: "other", scopes: ["read"] },
      issued,
      "id",
    );
    expect(admin.rows("document_events")[0]!["detail"]).toBe("Acme\uFFFD AV: read");
  });
  it("only the organisation administrator connects systems", async () => {
    for (const role of ["master_admin", "manager"]) {
      const admin = world();
      expect((await create(admin, ["read"], role)).ok, role).toBe(false);
      expect(admin.writes).toEqual([]);
    }
  });
});
describe("rotating a key", () => {
  it("is recorded before the old key stops working", () => {
    const src = readFileSync("src/services/integration-clients.functions.ts", "utf8");
    const rotate = src.slice(
      src.indexOf("export const rotateSystemKey"),
      src.indexOf("export const revokeSystem"),
    );
    const recorded = rotate.indexOf('"systemKeyRotated"');
    expect(recorded).toBeGreaterThan(0);
    expect(recorded).toBeLessThan(rotate.indexOf("key_hash:"));
  });
});
