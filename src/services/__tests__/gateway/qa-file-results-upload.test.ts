// QA, adversarial: confirming an uploadUrl upload (POST …/uploaded, R4.6). Wrong client, state, size,
// hash and version; a file that is missing or too large; replay and the key; the switch on and off.
// Tests that expose a real defect are `it.fails` with the defect named above them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Bytes } from "@/services/gateway-create-input";
import { confirmUpload, createDocument } from "@/test/gateway-api";
import {
  buildWorld,
  call,
  CLIENT_ID,
  json,
  KEY,
  OTHER_TENANT,
  TENANT,
  WRITE_LIMIT,
} from "@/test/gateway-world";
import { sha256Hex } from "@/services/tmf667-mapper";
import type { FakeDb } from "@/test/fake-db";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);
const BYTES = new TextEncoder().encode("%PDF-1.7 qa upload report") as Uint8Array<ArrayBuffer>;
const SECRET_NAME = "Aurora merger QA upload";
const ENTITY = "ent-1";
const KEY_OTHER = "erad_" + "o".repeat(24);
const KEY_AV = "erad_" + "a".repeat(24);
let HEX = "";
let logs: string[] = [];
beforeEach(async () => {
  HEX = await sha256Bytes(BYTES);
  logs = [];
  for (const k of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, k).mockImplementation(
      (...a: unknown[]) => void logs.push(a.map(String).join(" ")),
    );
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(logs.join("\n")).not.toContain(SECRET_NAME);
});
async function world(opts: { hits?: number } = {}) {
  const db = await buildWorld({
    documents: [],
    ...(opts.hits !== undefined ? { hits: opts.hits } : {}),
    specs: [{ code: "contract", name: "Contract", definition: { category: "Legal" } }],
  });
  db.tables["business_entities"] = [{ id: ENTITY, tenant_id: TENANT }];
  const base = db.rows("integration_clients")[0]!;
  db.rows("integration_clients").push(
    {
      ...base,
      id: "client-2",
      name: "Other register",
      key_hash: await sha256Hex(KEY_OTHER),
      scopes: ["register"],
    },
    {
      ...base,
      id: "client-av",
      name: "Acme AV",
      key_hash: await sha256Hex(KEY_AV),
      scopes: ["scan"],
    },
  );
  return db;
}
/** Registers without content (the uploadUrl way) and optionally puts the object in storage. */
async function registered(
  db: FakeDb,
  o: { hash?: string; size?: number; object?: Uint8Array | null } = {},
) {
  const res = await createDocument(
    call("POST", "/document", {
      body: {
        name: SECRET_NAME,
        documentType: "contract",
        relatedEntity: [{ id: ENTITY, role: "contract" }],
        attachment: {
          mimeType: "application/pdf",
          contentHash: o.hash ?? HEX,
          size: o.size ?? BYTES.byteLength,
        },
      },
    }),
  );
  expect(res.status).toBe(201);
  const doc = db.rows("documents")[0]!;
  const version = db.rows("document_versions")[0]!;
  baseline = db.writesTo("documents", "update").length;
  if (o.object !== null) db.objects.set(`documents/${version["storage_path"]}`, o.object ?? BYTES);
  return { id: String(doc["id"]), v: String(version["id"]) };
}
const confirm = (id: string, v: string, o: { key?: string; idem?: string | null } = {}) =>
  confirmUpload(
    call("POST", `/document/${id}/attachment/${v}/uploaded`, {
      ...(o.key ? { key: o.key } : {}),
      ...(o.idem !== undefined ? { idempotencyKey: o.idem } : {}),
    }),
    id,
    v,
  );
const state = (db: FakeDb) => db.rows("documents")[0]!["pipeline_state"];
const codeOf = async (res: Response) => (await json(res))["code"];
/** Writes to documents so far (registration itself updates the row once); a refusal adds none. */
let baseline = 0;
const untouched = (db: FakeDb) => {
  expect(state(db)).toBe("uploading");
  expect(db.writesTo("documents", "update")).toHaveLength(baseline);
};

describe("the right confirmation", () => {
  it("switch off: the server reads the file, checks size and hash, and runs the built-in steps", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    const res = await confirm(id, v);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id, versionId: v, state: "ready" });
  });
  it("a stored hash in upper case or with sha256: (as the screens write it) is the same hash", async () => {
    for (const h of [HEX.toUpperCase(), `sha256:${HEX}`, `sha256:${HEX.toUpperCase()}`]) {
      const db = await world();
      const { id, v } = await registered(db);
      db.rows("document_versions")[0]!["content_hash"] = h;
      expect((await confirm(id, v)).status).toBe(200);
      expect(state(db)).toBe("ready");
    }
  });
  it("switch on for scan: the file waits for the antivirus and the confirm says so", async () => {
    const db = await world();
    db.rows("tenants")[0]!["external_processing"] = { scan: true };
    const { id, v } = await registered(db);
    const res = await confirm(id, v);
    expect(await json(res)).toMatchObject({ state: "scanning" });
    expect(db.rows("documents")[0]!["pipeline_detail"]).toMatchObject({
      mode: "external",
      step: "scan",
      attempt: 1,
    });
  });
  it("a confirm answered twice under the same key is replayed, not run twice", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    await confirm(id, v, { idem: "same-key-0001" });
    const writes = db.writesTo("documents").length;
    const again = await confirm(id, v, { idem: "same-key-0001" });
    expect(again.headers.get("Idempotent-Replay")).toBe("true");
    expect(db.writesTo("documents")).toHaveLength(writes);
  });
  // R4.6 / R2.8 spirit: a client whose confirm reply was lost and that retries under a new key is
  // told the upload "was already confirmed" (409) although it was its own confirm that did it.
  it("a lost reply retried under a new key answers 409 notUploading (pins today's behaviour)", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    await confirm(id, v, { idem: "first-key-0001" });
    const again = await confirm(id, v, { idem: "second-key-002" });
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("notUploading");
    expect(state(db)).toBe("ready");
  });
});

describe("refusals leave the document uploading", () => {
  it("no file stored", async () => {
    const db = await world();
    const { id, v } = await registered(db, { object: null });
    const res = await confirm(id, v);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("fileMissing");
    untouched(db);
  });
  it("a file of another size than declared", async () => {
    const db = await world();
    const { id, v } = await registered(db, { size: BYTES.byteLength + 1 });
    expect(await codeOf(await confirm(id, v))).toBe("sizeMismatch");
    untouched(db);
  });
  it("a file with another hash than declared, same size", async () => {
    const db = await world();
    const { id, v } = await registered(db, {
      object: new TextEncoder().encode("%PDF-1.7 qa upload reporT"),
    });
    expect(await codeOf(await confirm(id, v))).toBe("hashMismatch");
    untouched(db);
  });
  it("size and hash both wrong: the size is the one named (it is checked first)", async () => {
    const db = await world();
    const { id, v } = await registered(db, { size: 3 });
    expect(await codeOf(await confirm(id, v))).toBe("sizeMismatch");
    untouched(db);
  });
  it("a stored file over 25 MB is 413 tooLarge", async () => {
    const db = await world();
    const big = new Uint8Array(26_214_401);
    const { id, v } = await registered(db, { size: big.byteLength, object: big });
    const res = await confirm(id, v);
    expect(res.status).toBe(413);
    expect(await codeOf(res)).toBe("tooLarge");
    untouched(db);
  });
  it("a stored file of exactly 25 MB is read", async () => {
    const db = await world();
    const big = new Uint8Array(26_214_400);
    const { id, v } = await registered(db, {
      hash: await sha256Bytes(big as Uint8Array<ArrayBuffer>),
      size: big.byteLength,
      object: big,
    });
    expect((await confirm(id, v)).status).toBe(200);
  });
  it("a refusal does not burn the key: the same request goes through once the file is there", async () => {
    const db = await world();
    const { id, v } = await registered(db, { object: null });
    expect((await confirm(id, v, { idem: "same-key-0001" })).status).toBe(409);
    db.objects.set(`documents/${db.rows("document_versions")[0]!["storage_path"]}`, BYTES);
    expect((await confirm(id, v, { idem: "same-key-0001" })).status).toBe(200);
  });
  it("storage failing to answer is a refusal, never a pass", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    db.failStorage("download");
    const res = await confirm(id, v);
    expect(res.status).toBeGreaterThanOrEqual(409);
    untouched(db);
  });
});

describe("who and what", () => {
  it("a malformed id is 404 before anything is remembered for the key (seg L3)", async () => {
    const db = await world();
    const { v } = await registered(db);
    const keys = db.writesTo("idempotency_keys").length;
    const res = await confirm("not-a-uuid", v, { idem: "key-malformed-1" });
    expect(res.status).toBe(404);
    expect(db.writesTo("idempotency_keys")).toHaveLength(keys);
  });
  it("another system with `register` is refused, and a scanner key is refused by scope", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    const other = await confirm(id, v, { key: KEY_OTHER });
    expect(other.status).toBe(403);
    expect(await codeOf(other)).toBe("notRegisteredHere");
    const av = await confirm(id, v, { key: KEY_AV });
    expect(av.status).toBe(403);
    expect(await codeOf(av)).toBe("scopeMissing");
    untouched(db);
  });
  it("a document registered by a person (no registering system) cannot be confirmed by a system", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    db.rows("documents")[0]!["registered_by_client"] = null;
    expect((await confirm(id, v)).status).toBe(403);
    untouched(db);
  });
  it.each([
    ["ready", "ready"],
    ["scanning", "scanning"],
    ["reading", "reading"],
    ["quarantined", "quarantined"],
    ["failed", "failed"],
  ])("a document that is %s is not confirmed again", async (_n, s) => {
    const db = await world();
    const { id, v } = await registered(db);
    db.rows("documents")[0]!["pipeline_state"] = s;
    const res = await confirm(id, v);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("notUploading");
    expect(db.writesTo("documents", "update")).toHaveLength(baseline);
  });
  it("an older version, another document, an unknown id and an id that is not a uuid", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    db.rows("document_versions").push({
      ...db.rows("document_versions")[0]!,
      id: "66666666-6666-4666-8666-666666666666",
    });
    expect(await codeOf(await confirm(id, "66666666-6666-4666-8666-666666666666"))).toBe(
      "versionNotCurrent",
    );
    expect((await confirm("55555555-5555-4555-8555-555555555555", v)).status).toBe(404);
    expect((await confirm(id, "77777777-7777-4777-8777-777777777777")).status).toBe(404);
    expect((await confirm(id, "../x")).status).toBe(404);
    expect((await confirm("x'; drop table documents; --", v)).status).toBe(404);
    untouched(db);
  });
  it("another organisation's document and version are the same 404", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    db.rows("documents")[0]!["tenant_id"] = OTHER_TENANT;
    expect((await confirm(id, v)).status).toBe(404);
    db.rows("documents")[0]!["tenant_id"] = TENANT;
    db.rows("document_versions")[0]!["tenant_id"] = OTHER_TENANT;
    expect((await confirm(id, v)).status).toBe(404);
    untouched(db);
  });
  it("a deleted document is not found", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    db.rows("documents")[0]!["deleted_at"] = "2026-11-24T10:00:00Z";
    expect((await confirm(id, v)).status).toBe(404);
  });
  it("counts against the write allowance; a 429 changes nothing", async () => {
    const db = await world({ hits: WRITE_LIMIT + 1 });
    // Registration is also a write: build the document directly instead.
    db.tables["documents"] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenant_id: TENANT,
        pipeline_state: "uploading",
        pipeline_detail: null,
        current_version_id: "33333333-3333-4333-8333-333333333333",
        registered_by_client: CLIENT_ID,
        document_type: "contract",
        name: SECRET_NAME,
      },
    ];
    const res = await confirm(
      "11111111-1111-4111-8111-111111111111",
      "33333333-3333-4333-8333-333333333333",
    );
    expect(res.status).toBe(429);
    expect(state(db)).toBe("uploading");
  });
  it("a missing or bad Idempotency-Key is a 400 before any work", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    for (const idem of [null, "short"]) expect((await confirm(id, v, { idem })).status).toBe(400);
    untouched(db);
  });
  it("without a key at all is a 401", async () => {
    const db = await world();
    const { id, v } = await registered(db);
    const res = await confirmUpload(
      call("POST", `/document/${id}/attachment/${v}/uploaded`, { key: null }),
      id,
      v,
    );
    expect(res.status).toBe(401);
    void KEY;
    untouched(db);
  });
});

describe("a registration that declared no hash or no size", () => {
  const registerBare = async (db: FakeDb, attachment: Record<string, unknown>) => {
    const res = await createDocument(
      call("POST", "/document", {
        body: {
          name: SECRET_NAME,
          documentType: "contract",
          relatedEntity: [{ id: ENTITY, role: "contract" }],
          attachment: { mimeType: "application/pdf", ...attachment },
        },
      }),
    );
    return res;
  };
  it("no hash, url or content is refused at registration, so no upload can be unconfirmable", async () => {
    const db = await world();
    const res = await registerBare(db, {});
    expect(res.status).toBe(400);
    expect(db.rows("documents")).toEqual([]);
  });
  it("a declared hash with no declared size is confirmed on the hash alone", async () => {
    const db = await world();
    const res = await registerBare(db, { contentHash: HEX });
    expect(res.status).toBe(201);
    const v = String(db.rows("document_versions")[0]!["id"]);
    const id = String(db.rows("documents")[0]!["id"]);
    db.objects.set(`documents/${db.rows("document_versions")[0]!["storage_path"]}`, BYTES);
    expect((await confirm(id, v)).status).toBe(200);
  });
});
