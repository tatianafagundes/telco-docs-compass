// QA, adversarial: the whole life of a file through the HTTP handlers only. POST /document with the
// organisation switch on and off, the scanner and reader downloads and answers, then a read key's
// download; an infected file; a file that is stuck; uploaded; and the logs and stored replies.
// Tests that expose a real defect are `it.fails` with the defect named above them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Bytes } from "@/services/gateway-create-input";
import {
  confirmUpload,
  createDocument,
  getAttachmentContent,
  postExtractionResult,
  postScanResult,
} from "@/test/gateway-api";
import { buildWorld, call, CLIENT_ID, json, OTHER_TENANT, TENANT } from "@/test/gateway-world";
import { sha256Hex } from "@/services/tmf667-mapper";
import type { FakeDb } from "@/test/fake-db";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);
const KEY_AV = "erad_" + "a".repeat(24);
const KEY_RD = "erad_" + "r".repeat(24);
const THREAT = "Eicar-QA-Flow";
const SECRET_VALUE = "SEK 12,345,678 QA flow";
const SECRET_NAME = "Aurora merger QA flow";
const ENTITY = "ent-1";
const TEXT = "%PDF-1.7 qa flow report";
const BYTES = new TextEncoder().encode(TEXT) as Uint8Array<ArrayBuffer>;
let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const k of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, k).mockImplementation(
      (...a: unknown[]) => void logs.push(a.map(String).join(" ")),
    );
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of [THREAT, SECRET_VALUE, SECRET_NAME]) expect(logs.join("\n")).not.toContain(s);
});
const client = (id: string, name: string, scopes: string[], key: string, hash: string) => ({
  id,
  name,
  tenant_id: TENANT,
  scopes,
  revoked_at: null,
  expires_at: null,
  read_limit_per_minute: 120,
  write_limit_per_minute: 30,
  key_hash: hash,
  created_by: null,
  created_at: `2026-11-0${id === "client-av" ? 2 : 3}T10:00:00Z`,
  _key: key,
});
async function world(sw: { scan?: boolean; read?: boolean }) {
  const db = await buildWorld({
    documents: [],
    specs: [
      {
        code: "contract",
        name: "Contract",
        definition: {
          category: "Legal",
          specCharacteristic: [
            { name: "amount", valueType: "string" },
            { name: "signedOn", valueType: "date" },
          ],
        },
      },
    ],
  });
  db.tables["business_entities"] = [
    { id: ENTITY, tenant_id: TENANT },
    { id: "ent-other", tenant_id: OTHER_TENANT },
  ];
  db.rows("tenants")[0]!["external_processing"] = sw;
  const av = client("client-av", "Acme AV", ["scan"], KEY_AV, await sha256Hex(KEY_AV));
  const rd = client("client-rd", "Acme Reader", ["extract"], KEY_RD, await sha256Hex(KEY_RD));
  db.rows("integration_clients").push(
    ...[av, rd].map(({ _key, ...row }) => {
      void _key;
      return row;
    }),
  );
  return db;
}
const body = (over: Record<string, unknown> = {}, content = TEXT) => ({
  name: SECRET_NAME,
  documentType: "contract",
  relatedEntity: [{ id: ENTITY, role: "contract" }],
  attachment: { mimeType: "application/pdf", content: btoa(content) },
  ...over,
});
async function register(db: FakeDb, over: Record<string, unknown> = {}, content = TEXT) {
  const res = await createDocument(
    call("POST", "/document", {
      body: body(over, content),
      idempotencyKey: `reg-${Math.random().toString(36).slice(2)}0`,
    }),
  );
  expect(res.status).toBe(201);
  const doc = db.rows("documents")[0]!;
  return { id: String(doc["id"]), doc };
}
const versionOf = (db: FakeDb) => String(db.rows("document_versions")[0]!["id"]);
const link = (id: string, v: string, key?: string) =>
  getAttachmentContent(
    call("GET", `/document/${id}/attachment/${v}/content`, key ? { key } : {}),
    id,
    v,
  );
const scanPost = (
  id: string,
  v: string,
  hash: string,
  attempt: number,
  result: string,
  extra = {},
) =>
  postScanResult(
    call("POST", `/document/${id}/attachment/${v}/scanResult`, {
      key: KEY_AV,
      body: { result, contentHash: hash, attempt, engine: "AcmeAV 9", ...extra },
      idempotencyKey: `scan-${result}-${attempt}-000`,
    }),
    id,
    v,
  );
const readPost = (id: string, v: string, attempt: number, payload: Record<string, unknown>) =>
  postExtractionResult(
    call("POST", `/document/${id}/attachment/${v}/extractionResult`, {
      key: KEY_RD,
      body: { attempt, ...payload },
      idempotencyKey: `read-${attempt}-0000`,
    }),
    id,
    v,
  );
const state = (db: FakeDb) => db.rows("documents")[0]!["pipeline_state"];
const codeOf = async (res: Response) => (await json(res))["code"];

describe("POST /document with the switch off", () => {
  it("a clean file ends ready, by the server's own steps, and a read key can then download it", async () => {
    const db = await world({});
    const { id } = await register(db);
    expect(state(db)).toBe("ready");
    expect((await link(id, versionOf(db))).status).toBe(200);
  });
  it("an infected file (the built-in marker) ends quarantined, and nobody downloads it", async () => {
    const db = await world({});
    const { id } = await register(db, {}, "TEST-QUARANTINE here");
    expect(state(db)).toBe("quarantined");
    const v = versionOf(db);
    for (const key of [undefined, KEY_AV, KEY_RD]) {
      const res = await link(id, v, key);
      expect([403, 409]).toContain(res.status);
      if (res.status === 409) expect(await codeOf(res)).toMatch(/quarantined|notYourStep/);
    }
    expect(db.storageCalls.filter((c) => c.op === "createSignedUrl")).toEqual([]);
  });
  it("the built-in name rule applies to API files too: a name ending .exe is quarantined", async () => {
    const db = await world({});
    await register(db, { name: "setup.EXE" });
    expect(state(db)).toBe("quarantined");
  });
  it("an unreadable file (the built-in marker) ends failed at reading, never ready", async () => {
    const db = await world({});
    await register(db, {}, "TEST-UNREADABLE x");
    expect(state(db)).toBe("failed");
    expect(db.rows("documents")[0]!["pipeline_detail"]).toMatchObject({
      step: "read",
      reason: "unreadable",
    });
  });
  it("processing that cannot run leaves the file waiting in uploading, never ready, and uploaded finishes it", async () => {
    const db = await world({});
    db.failStorage("download");
    await register(db);
    expect(state(db)).toBe("uploading");
    const v = versionOf(db);
    const id = String(db.rows("documents")[0]!["id"]);
    // Not downloadable while it waits (H5): the file was not checked.
    expect(await codeOf(await link(id, v))).toBe("contentLocked");
    db.clearStorageFailures();
    const res = await confirmUpload(
      call("POST", `/document/${id}/attachment/${v}/uploaded`),
      id,
      v,
    );
    expect(res.status).toBe(200);
    expect(state(db)).toBe("ready");
  });
  it("a storage download that throws is logged without the name and does not turn into ready", async () => {
    const db = await world({});
    db.throwStorage("download");
    const res = await createDocument(call("POST", "/document", { body: body() }));
    expect([201, 503]).toContain(res.status);
    expect(state(db)).not.toBe("ready");
  });
});

describe("POST /document with the switch on", () => {
  it("scan on: the file waits for the organisation's antivirus; the built-in marker is not applied", async () => {
    const db = await world({ scan: true });
    await register(db, {}, "TEST-QUARANTINE here");
    expect(state(db)).toBe("scanning");
    expect(db.rows("documents")[0]!["pipeline_detail"]).toMatchObject({
      mode: "external",
      byClient: "client-av",
      step: "scan",
      attempt: 1,
    });
  });
  it("scan on with no antivirus connected: the file waits for nobody, is not downloadable by anyone, and never falls back to simulation", async () => {
    const db = await world({ scan: true });
    db.rows("integration_clients").splice(1, 2);
    const { id } = await register(db);
    expect(state(db)).toBe("scanning");
    expect(db.rows("documents")[0]!["pipeline_detail"]).toMatchObject({ mode: "external" });
    expect(db.rows("documents")[0]!["pipeline_detail"]).not.toHaveProperty("byClient");
    const v = versionOf(db);
    expect((await link(id, v)).status).toBe(409);
  });
  it("read on, scan off: the built-in scan runs, then the file waits for the reader", async () => {
    const db = await world({ read: true });
    await register(db);
    expect(state(db)).toBe("reading");
    expect(db.rows("documents")[0]!["pipeline_detail"]).toMatchObject({
      mode: "external",
      byClient: "client-rd",
      step: "read",
      attempt: 2,
    });
  });
  it("read on, scan off, infected: quarantined before the reader is told anything", async () => {
    const db = await world({ read: true });
    await register(db, {}, "TEST-QUARANTINE");
    expect(state(db)).toBe("quarantined");
  });
});

describe("the full sequence: scanner download, clean, reader download, read, a read key", () => {
  it("every step through the HTTP handlers, with the downloads and answers that belong to it", async () => {
    const db = await world({ scan: true, read: true });
    const { id } = await register(db);
    const v = versionOf(db);
    const hex = await sha256Bytes(BYTES);
    expect(state(db)).toBe("scanning");

    // Nobody but the scanner downloads during the scan.
    expect(await codeOf(await link(id, v))).toBe("contentLocked");
    expect(await codeOf(await link(id, v, KEY_RD))).toBe("notYourStep");
    // The scanner cannot say clean before it downloaded, and a reader cannot answer a scan.
    expect(await codeOf(await scanPost(id, v, hex, 1, "clean"))).toBe("notFetched");
    expect(
      (
        await postScanResult(
          call("POST", `/document/${id}/attachment/${v}/scanResult`, {
            key: KEY_RD,
            body: { result: "clean", contentHash: hex, attempt: 1, engine: "x" },
          }),
          id,
          v,
        )
      ).status,
    ).toBe(403);

    expect((await link(id, v, KEY_AV)).status).toBe(200);
    expect(db.rows("document_events").filter((e) => e["action"] === "scanDownload")).toHaveLength(
      1,
    );
    // A wrong hash and a wrong attempt are still refused after the download.
    expect(await codeOf(await scanPost(id, v, "0".repeat(64), 1, "clean"))).toBe("hashMismatch");
    expect(await codeOf(await scanPost(id, v, hex, 2, "clean"))).toBe("staleAttempt");
    expect(state(db)).toBe("scanning");

    const clean = await scanPost(id, v, hex, 1, "clean");
    expect(clean.status).toBe(200);
    expect(state(db)).toBe("reading");
    expect(db.rows("documents")[0]!["pipeline_detail"]).toMatchObject({
      mode: "external",
      byClient: "client-rd",
      step: "read",
      attempt: 2,
    });

    // During reading: the scanner is out, the reader is in, a read key may get the checked file.
    expect(await codeOf(await link(id, v, KEY_AV))).toBe("notYourStep");
    expect((await link(id, v, KEY_RD)).status).toBe(200);
    expect(db.rows("document_events").filter((e) => e["action"] === "scanDownload")).toHaveLength(
      1,
    );
    // A reader answering with the scan's attempt is stale; a scanner cannot answer a reading.
    expect(await codeOf(await readPost(id, v, 1, { result: "unreadable" }))).toBe("staleAttempt");
    expect(await codeOf(await scanPost(id, v, hex, 2, "clean"))).toBe("notScanning");

    const done = await readPost(id, v, 2, {
      result: "read",
      fields: [
        { name: "amount", value: SECRET_VALUE, confidence: 0.95, source: "page 1" },
        { name: "signedOn", value: "2026-11-24", confidence: 0.8 },
      ],
    });
    expect(done.status).toBe(200);
    expect(await json(done)).toMatchObject({ state: "ready", proposed: 2 });
    expect(state(db)).toBe("ready");
    expect(db.rows("extraction_fields").map((r) => [r["name"], r["status"], r["band"]])).toEqual([
      ["amount", "pending", "high"],
      ["signedOn", "pending", "medium"],
    ]);
    // Nothing is confirmed by the system.
    expect(JSON.stringify(db.rows("documents")[0]!["characteristic"] ?? {})).not.toContain(
      SECRET_VALUE,
    );

    // Done: a read key downloads, the scanner and reader no longer can.
    expect((await link(id, v)).status).toBe(200);
    expect(await codeOf(await link(id, v, KEY_AV))).toBe("notYourStep");
    expect(await codeOf(await link(id, v, KEY_RD))).toBe("notYourStep");
    // And an answer that arrives again is not applied twice.
    expect((await readPost(id, v, 2, { result: "unreadable" })).status).toBe(409);
    expect(state(db)).toBe("ready");
  });
  it("infected through HTTP: quarantined for the scanner, the reader, a read key and any later answer", async () => {
    const db = await world({ scan: true, read: true });
    const { id } = await register(db);
    const v = versionOf(db);
    const hex = await sha256Bytes(BYTES);
    expect((await link(id, v, KEY_AV)).status).toBe(200);
    const res = await scanPost(id, v, hex, 1, "infected", { threatName: THREAT });
    expect(await json(res)).toMatchObject({ state: "quarantined" });
    for (const key of [undefined, KEY_AV, KEY_RD])
      expect(await codeOf(await link(id, v, key))).toBe("quarantined");
    // The scanner changes its mind: no.
    expect((await scanPost(id, v, hex, 1, "clean")).status).toBe(409);
    expect(state(db)).toBe("quarantined");
    // The threat name is in the activity log only: not in the document, not in any stored reply.
    expect(JSON.stringify(db.rows("documents"))).not.toContain(THREAT);
    expect(JSON.stringify(db.rows("idempotency_keys"))).not.toContain(THREAT);
    expect(JSON.stringify(db.rows("extraction_fields"))).not.toContain(THREAT);
    expect(
      db.rows("document_events").filter((e) => String(e["detail"]).includes(THREAT)),
    ).toHaveLength(1);
  });
  it("a scanner that never answers is not helped: the document stays scanning and nobody else downloads", async () => {
    const db = await world({ scan: true });
    const { id } = await register(db);
    const v = versionOf(db);
    expect((await link(id, v, KEY_AV)).status).toBe(200);
    expect((await link(id, v, KEY_AV)).status).toBe(200);
    expect(await codeOf(await link(id, v))).toBe("contentLocked");
    expect(state(db)).toBe("scanning");
  });
  it("a scanner key of another organisation finds nothing", async () => {
    const db = await world({ scan: true });
    const { id } = await register(db);
    const v = versionOf(db);
    db.rows("integration_clients").forEach((c) => {
      if (c["id"] === "client-av") c["tenant_id"] = OTHER_TENANT;
    });
    expect((await link(id, v, KEY_AV)).status).toBe(404);
    expect((await scanPost(id, v, await sha256Bytes(BYTES), 1, "infected")).status).toBe(404);
    expect(state(db)).toBe("scanning");
  });
  it("the scanner key revoked mid-scan can neither download nor answer, and the file is not released", async () => {
    const db = await world({ scan: true });
    const { id } = await register(db);
    const v = versionOf(db);
    db.rows("integration_clients").forEach((c) => {
      if (c["id"] === "client-av") c["revoked_at"] = "2026-11-24T10:00:00Z";
    });
    expect((await link(id, v, KEY_AV)).status).toBe(401);
    expect((await scanPost(id, v, await sha256Bytes(BYTES), 1, "clean")).status).toBe(401);
    expect(state(db)).toBe("scanning");
  });
  it("a second connected antivirus makes both undesignated: neither answers", async () => {
    const db = await world({ scan: true });
    const { id } = await register(db);
    const v = versionOf(db);
    db.rows("integration_clients").push({
      ...db.rows("integration_clients").find((c) => c["id"] === "client-av")!,
      id: "client-av2",
      key_hash: await sha256Hex("erad_" + "b".repeat(24)),
      created_at: "2026-11-09T10:00:00Z",
    });
    const res = await link(id, v, KEY_AV);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("notDesignated");
    expect(state(db)).toBe("scanning");
  });
});

describe("a stored reply or activity entry never carries a value or a name", () => {
  it("after a whole flow, no stored idempotency reply, activity entry or detail holds the file name or a value", async () => {
    const db = await world({ scan: true, read: true });
    const { id } = await register(db);
    const v = versionOf(db);
    const hex = await sha256Bytes(BYTES);
    await link(id, v, KEY_AV);
    await scanPost(id, v, hex, 1, "clean");
    await readPost(id, v, 2, {
      result: "read",
      fields: [{ name: "amount", value: SECRET_VALUE, confidence: 0.9 }],
    });
    for (const table of ["idempotency_keys", "document_events"]) {
      const text = JSON.stringify(db.rows(table));
      expect(text, table).not.toContain(SECRET_VALUE);
    }
  });
});
