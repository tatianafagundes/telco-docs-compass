// The organisation's antivirus and reader answers, and confirming an upload (file-hooks spec R2, R3,
// R4.6, R6; task 5.6). Every refusal writes nothing to the document; answers are idempotent and
// replayable; values, threat names and file names never reach a log.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Bytes } from "@/services/gateway-create-input";
import { confirmUpload, postExtractionResult, postScanResult } from "@/test/gateway-api";
import {
  buildWorld,
  call,
  CLIENT_ID,
  DOC_ID,
  docRow,
  json,
  OTHER_TENANT,
  TENANT,
  WRITE_LIMIT,
} from "@/test/gateway-world";
import type { FakeDb } from "@/test/fake-db";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const V = "33333333-3333-4333-8333-333333333333";
const OLD = "44444444-4444-4444-8444-444444444444";
const BYTES = new TextEncoder().encode("%PDF-1.7 clean report") as Uint8Array<ArrayBuffer>;
let HEX = "";
const THREAT = "Eicar-Test-Signature";
const SECRET_NAME = "Merger plan Aurora.pdf";
const SECRET_VALUE = "SEK 48,000,000";
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
  // No value, threat name or file name in any log line (R2.7, R6.4).
  for (const s of [THREAT, SECRET_NAME, SECRET_VALUE]) expect(logs.join("\n")).not.toContain(s);
});

const external = (step: "scan" | "read", over: Record<string, unknown> = {}) => ({
  mode: "external",
  by: "Order care",
  byClient: CLIENT_ID,
  step,
  attempt: 3,
  quarantinedVersions: [],
  ...over,
});
async function world(
  scopes: string[],
  doc: Record<string, unknown> = {},
  opts: { specs?: unknown[] } = {},
) {
  const db = await buildWorld({
    scopes,
    specs: opts.specs ?? [],
    documents: [
      docRow({
        name: SECRET_NAME,
        current_version_id: V,
        pipeline_state: "scanning",
        pipeline_detail: external("scan"),
        registered_by_client: CLIENT_ID,
        created_by: null,
        ...doc,
      }),
    ],
  });
  db.tables["document_versions"] = [V, OLD].map((id) => ({
    id,
    document_id: DOC_ID,
    tenant_id: TENANT,
    storage_path: `${TENANT}/${id}`,
    content_hash: `sha256:${HEX}`,
    size_bytes: BYTES.byteLength,
  }));
  db.objects.set(`documents/${TENANT}/${V}`, BYTES);
  return db;
}
const fetched = (db: FakeDb, attempt = 3, version = V) =>
  db.rows("document_events").push({
    tenant_id: TENANT,
    document_id: DOC_ID,
    version_id: version,
    action: "scanDownload",
    detail: `attempt ${attempt} · via Order care`,
    created_at: "2026-11-24T10:00:00Z",
  });
const scan = (body: Record<string, unknown>, o: { id?: string; v?: string; key?: string } = {}) =>
  postScanResult(
    call("POST", `/document/${o.id ?? DOC_ID}/attachment/${o.v ?? V}/scanResult`, {
      body: { contentHash: HEX, attempt: 3, engine: "ClamAV 1.3", ...body },
      ...(o.key ? { idempotencyKey: o.key } : {}),
    }),
    o.id ?? DOC_ID,
    o.v ?? V,
  );
const doc = (db: FakeDb) => db.rows("documents").find((d) => d["id"] === DOC_ID)!;
const docWrites = (db: FakeDb) => db.writesTo("documents").filter((w) => w.rows.length > 0);
const codeOf = async (res: Response) => (await json(res))["code"];

describe("scanResult", () => {
  it("clean: the file moves on to reading, which the server runs when it is built in", async () => {
    const db = await world(["scan"]);
    fetched(db);
    const res = await scan({ result: "clean" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: DOC_ID, versionId: V, state: "ready", attempt: 3 });
    expect(db.rows("document_events").map((e) => e["action"])).toContain("scanResult");
  });
  it("infected: quarantined for good, and the threat name is in the activity log only", async () => {
    const db = await world(["scan"]);
    const res = await scan({ result: "infected", threatName: THREAT });
    expect((await json(res))["state"]).toBe("quarantined");
    expect(doc(db)).toMatchObject({
      pipeline_state: "quarantined",
      pipeline_detail: { reason: "threat", quarantinedVersions: [V] },
    });
    expect(JSON.stringify(doc(db)["pipeline_detail"])).not.toContain(THREAT);
    expect(
      db.rows("document_events").find((e) => e["action"] === "scanResult")!["detail"],
    ).toContain(THREAT);
  });
  it("error: the scan failed and can be tried again", async () => {
    const db = await world(["scan"]);
    await scan({ result: "error" });
    expect(doc(db)).toMatchObject({
      pipeline_state: "failed",
      pipeline_detail: { reason: "scanError", step: "scan" },
    });
  });
  it.each([
    ["an unknown document", { id: "55555555-5555-4555-8555-555555555555" }, {}, 404, "notFound"],
    ["another organisation's document", {}, { tenant_id: OTHER_TENANT }, 404, "notFound"],
    ["an unknown version", { v: "66666666-6666-4666-8666-666666666666" }, {}, 404, "notFound"],
    ["an id that is not a uuid", { v: "../x" }, {}, 404, "notFound"],
    ["an older version", { v: OLD }, {}, 409, "versionNotCurrent"],
    ["a document that is not scanning", {}, { pipeline_state: "ready" }, 409, "notScanning"],
    [
      "a built-in scan",
      {},
      { pipeline_detail: { mode: "simulated", attempt: 3 } },
      409,
      "notScanning",
    ],
    [
      "a step owned by another system",
      {},
      { pipeline_detail: external("scan", { byClient: "client-9" }) },
      409,
      "notYourStep",
    ],
    [
      "an earlier attempt",
      {},
      { pipeline_detail: external("scan", { attempt: 4 }) },
      409,
      "staleAttempt",
    ],
  ])("refuses %s, and writes nothing", async (_n, o, docOver, status, code) => {
    const db = await world(["scan"], docOver);
    fetched(db);
    const res = await scan({ result: "clean" }, o);
    expect(res.status).toBe(status);
    expect(await codeOf(res)).toBe(code);
    expect(docWrites(db)).toEqual([]);
  });
  it("a version row of another organisation under this document id is not found", async () => {
    const db = await world(["scan"]);
    db.rows("document_versions")[0]!["tenant_id"] = OTHER_TENANT;
    const res = await scan({ result: "error" });
    expect(res.status).toBe(404);
    expect(docWrites(db)).toEqual([]);
  });
  it("refuses a hash that is not the stored file's", async () => {
    const db = await world(["scan"]);
    const res = await scan({ result: "infected", threatName: THREAT, contentHash: "0".repeat(64) });
    expect(await codeOf(res)).toBe("hashMismatch");
    expect(docWrites(db)).toEqual([]);
  });
  it("refuses clean from a system that did not download the file in this attempt", async () => {
    const db = await world(["scan"]);
    fetched(db, 2);
    const res = await scan({ result: "clean" });
    expect(await codeOf(res)).toBe("notFetched");
    expect(docWrites(db)).toEqual([]);
  });
  it("answers the same result again with the stored outcome, under a new key (lost reply)", async () => {
    const db = await world(["scan"]);
    await scan({ result: "infected", threatName: THREAT }, { key: "first-key-01" });
    const again = await scan({ result: "infected", threatName: THREAT }, { key: "second-key-02" });
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ state: "quarantined", replayed: true });
    expect(docWrites(db)).toHaveLength(1);
  });
  it("the same key and body is replayed by the idempotency store", async () => {
    await world(["scan"]);
    await scan({ result: "error" });
    const again = await scan({ result: "error" });
    expect(again.headers.get("Idempotent-Replay")).toBe("true");
  });
  it("two answers racing: the one that read an older state changes nothing", async () => {
    const db = await world(["scan"]);
    db.stubNextSelect("documents", [{ ...doc(db) }]);
    doc(db)["pipeline_detail"] = external("scan", { attempt: 4 });
    const res = await scan({ result: "error" });
    expect(await codeOf(res)).toBe("changedMeanwhile");
    expect(doc(db)["pipeline_state"]).toBe("scanning");
  });
  it("a body that is wrong is refused without repeating what it said", async () => {
    await world(["scan"]);
    const res = await scan({ result: "clean", engine: `<b>${THREAT}</b>` });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await json(res))).not.toContain(THREAT);
  });
  it("counts against the write allowance; a 429 changes nothing", async () => {
    const db = await buildWorld({ scopes: ["scan"], hits: WRITE_LIMIT + 1 });
    const res = await scan({ result: "error" });
    expect(res.status).toBe(429);
    expect(docWrites(db)).toEqual([]);
  });
  it.each([["read"], ["extract"], ["register"]])("a %s key cannot answer a scan", async (scope) => {
    await world([scope]);
    expect((await scan({ result: "error" })).status).toBe(403);
  });
});

const read = (body: Record<string, unknown>) =>
  postExtractionResult(
    call("POST", `/document/${DOC_ID}/attachment/${V}/extractionResult`, {
      body: { attempt: 3, ...body },
    }),
    DOC_ID,
    V,
  );
const SPECS = [
  {
    code: "contract",
    definition: {
      specCharacteristic: [
        { name: "amount", valueType: "string", required: true, extractable: true },
        { name: "signedOn", valueType: "date" },
      ],
    },
  },
];
const reading = { pipeline_state: "reading", pipeline_detail: external("read") };

describe("extractionResult", () => {
  it("read: proposed details are pending, marked as from the system, and the document is ready", async () => {
    const db = await world(["extract"], reading, { specs: SPECS });
    const res = await read({
      result: "read",
      fields: [{ name: "amount", value: SECRET_VALUE, confidence: 0.95, source: "page 2" }],
    });
    expect(await json(res)).toMatchObject({ state: "ready", proposed: 1, skipped: [] });
    expect(db.rows("extraction_fields")).toMatchObject([
      {
        name: "amount",
        value: SECRET_VALUE,
        status: "pending",
        band: "high",
        version_id: V,
        tenant_id: TENANT,
        source: { system: CLIENT_ID, label: "page 2" },
      },
    ]);
    // Never accepted into the document's confirmed details by a system (R3.4).
    expect(JSON.stringify(doc(db)["characteristic"])).not.toContain(SECRET_VALUE);
    const activity = JSON.stringify(db.rows("document_events"));
    expect(activity).not.toContain(SECRET_VALUE);
  });
  it("a detail a person already has for this version keeps the person's value", async () => {
    const db = await world(["extract"], reading, { specs: SPECS });
    db.rows("extraction_fields").push({
      name: "amount",
      version_id: V,
      document_id: DOC_ID,
      tenant_id: TENANT,
      status: "edited",
    });
    const res = await read({
      result: "read",
      fields: [{ name: "amount", value: "1", confidence: 0.5 }],
    });
    expect(await json(res)).toMatchObject({ proposed: 0, skipped: ["amount"] });
    expect(db.rows("extraction_fields")).toHaveLength(1);
  });
  it("refuses unknown details as a whole, naming them, and writes nothing", async () => {
    const db = await world(["extract"], reading, { specs: SPECS });
    const res = await read({
      result: "read",
      fields: [
        { name: "amount", value: SECRET_VALUE, confidence: 0.9 },
        { name: "bankAccount", value: "x", confidence: 0.9 },
      ],
    });
    expect(res.status).toBe(400);
    const answer = await json(res);
    expect(answer).toMatchObject({ code: "unknownFields", names: ["bankAccount"] });
    expect(JSON.stringify(answer)).not.toContain(SECRET_VALUE);
    expect(db.rows("extraction_fields")).toEqual([]);
    expect(docWrites(db)).toEqual([]);
  });
  it("unreadable: the reading failed", async () => {
    const db = await world(["extract"], reading, { specs: SPECS });
    await read({ result: "unreadable" });
    expect(doc(db)).toMatchObject({
      pipeline_state: "failed",
      pipeline_detail: { reason: "unreadable" },
    });
  });
  it("takes the proposed details back when the document changed meanwhile", async () => {
    const db = await world(["extract"], reading, { specs: SPECS });
    db.stubNextSelect("documents", [{ ...doc(db) }]);
    doc(db)["pipeline_detail"] = external("read", { attempt: 4 });
    const res = await read({
      result: "read",
      fields: [{ name: "amount", value: "1", confidence: 0.5 }],
    });
    expect(await codeOf(res)).toBe("changedMeanwhile");
    expect(db.rows("extraction_fields")).toEqual([]);
  });
  it("a scanner cannot answer a reading", async () => {
    await world(["scan"], reading, { specs: SPECS });
    expect((await read({ result: "unreadable" })).status).toBe(403);
  });
});

const confirm = () =>
  confirmUpload(call("POST", `/document/${DOC_ID}/attachment/${V}/uploaded`), DOC_ID, V);
const uploading = { pipeline_state: "uploading", pipeline_detail: null };

describe("uploaded", () => {
  it("the registering system confirms: the server reads and checks the file, then runs the steps", async () => {
    const db = await world(["read", "register"], uploading);
    const res = await confirm();
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: DOC_ID, versionId: V, state: "ready" });
    expect(db.rows("document_events").map((e) => e["detail"])).toContain(
      "Upload confirmed · via Order care",
    );
  });
  it.each([
    ["the file is not stored yet", (db: FakeDb) => db.objects.clear(), "fileMissing"],
    [
      "the stored file is not the declared one",
      (db: FakeDb) =>
        void db.objects.set(
          `documents/${TENANT}/${V}`,
          new TextEncoder().encode("%PDF-1.7 other report"),
        ),
      "hashMismatch",
    ],
  ])("refuses when %s, and the document stays uploading", async (_n, change, code) => {
    const db = await world(["register"], uploading);
    change(db);
    const res = await confirm();
    expect(await codeOf(res)).toBe(code);
    expect(doc(db)["pipeline_state"]).toBe("uploading");
  });
  it("only the system that registered the document confirms it", async () => {
    const db = await world(["register"], { ...uploading, registered_by_client: "client-9" });
    const res = await confirm();
    expect(res.status).toBe(403);
    expect(docWrites(db)).toEqual([]);
  });
  it("an upload already confirmed is not confirmed again", async () => {
    await world(["register"], { pipeline_state: "ready" });
    expect(await codeOf(await confirm())).toBe("notUploading");
  });
});
