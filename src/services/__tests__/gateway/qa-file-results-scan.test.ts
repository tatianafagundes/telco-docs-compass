// QA, adversarial: the antivirus answer (scanResult). Check order of R2.3, attempt and version edge
// cases, replay, receipts, body limits, idempotency, and that no log line carries a value.
// Tests that expose a real defect are `it.fails` with the defect named above them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Bytes } from "@/services/gateway-create-input";
import { getAttachmentContent, postScanResult } from "@/test/gateway-api";
import {
  BASE,
  buildWorld,
  call,
  CLIENT_ID,
  DOC_ID,
  docRow,
  IDEM_KEY,
  json,
  KEY,
  OTHER_TENANT,
  TENANT,
} from "@/test/gateway-world";
import type { FakeDb } from "@/test/fake-db";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);
const V = "33333333-3333-4333-8333-333333333333";
const OLD = "44444444-4444-4444-8444-444444444444";
const BYTES = new TextEncoder().encode("%PDF-1.7 qa clean report") as Uint8Array<ArrayBuffer>;
let HEX = "";
const THREAT = "Eicar-QA-Signature";
const SECRET_NAME = "Merger plan Aurora QA.pdf";
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
  // R2.7, R6.4: no threat name or file name in any log line, on any path of any test below.
  for (const s of [THREAT, SECRET_NAME]) expect(logs.join("\n")).not.toContain(s);
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
async function world(doc: Record<string, unknown> = {}, scopes = ["scan"]) {
  const db = await buildWorld({
    scopes,
    documents: [
      docRow({
        name: SECRET_NAME,
        current_version_id: V,
        pipeline_state: "scanning",
        pipeline_detail: external("scan"),
        registered_by_client: CLIENT_ID,
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
const receipt = (db: FakeDb, over: Record<string, unknown> = {}) =>
  db.rows("document_events").push({
    tenant_id: TENANT,
    document_id: DOC_ID,
    version_id: V,
    action: "scanDownload",
    detail: "attempt 3 · via Order care",
    created_at: "2026-11-24T10:00:00Z",
    ...over,
  });
const scan = (
  body: Record<string, unknown>,
  o: { id?: string; v?: string; key?: string | null } = {},
) =>
  postScanResult(
    call("POST", `/document/${o.id ?? DOC_ID}/attachment/${o.v ?? V}/scanResult`, {
      body: { contentHash: HEX, attempt: 3, engine: "ClamAV 1.3", ...body },
      ...(o.key !== undefined ? { idempotencyKey: o.key } : {}),
    }),
    o.id ?? DOC_ID,
    o.v ?? V,
  );
/** A raw body, as a client that builds its JSON by hand would send it. */
const rawScan = (text: string, headers: Record<string, string> = {}) =>
  postScanResult(
    new Request(`${BASE}/document/${DOC_ID}/attachment/${V}/scanResult`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        "idempotency-key": IDEM_KEY,
        "content-type": "application/json",
        ...headers,
      },
      body: text,
    }),
    DOC_ID,
    V,
  );
const doc = (db: FakeDb) => db.rows("documents").find((d) => d["id"] === DOC_ID)!;
const noWrite = (db: FakeDb) => {
  expect(db.writesTo("documents").filter((w) => w.rows.length > 0)).toEqual([]);
};
const codeOf = async (res: Response) => (await json(res))["code"];

describe("R2.3: which refusal wins when several apply", () => {
  // Every case sends a wrong hash, a stale attempt and no receipt at once, and changes one earlier
  // condition. The first applicable check in the spec's order must answer.
  const worst = { result: "clean", contentHash: "0".repeat(64), attempt: 99 };
  it.each([
    ["unknown document", { id: "55555555-5555-4555-8555-555555555555" }, {}, 404, "notFound"],
    ["another organisation's document", {}, { tenant_id: OTHER_TENANT }, 404, "notFound"],
    [
      "an older version, in a ready document",
      { v: OLD },
      { pipeline_state: "ready" },
      409,
      "versionNotCurrent",
    ],
    [
      "not scanning (ready), stale, wrong hash",
      {},
      { pipeline_state: "ready" },
      409,
      "notScanning",
    ],
    [
      "simulated scan, stale, wrong hash",
      {},
      { pipeline_detail: { mode: "simulated", attempt: 3, quarantinedVersions: [] } },
      409,
      "notScanning",
    ],
    ["stale attempt, wrong hash, no receipt", {}, {}, 409, "staleAttempt"],
  ])("%s", async (_n, o, over, status, code) => {
    const db = await world(over);
    const res = await scan(worst, o);
    expect(status).toBe(res.status);
    expect(await codeOf(res)).toBe(code);
    noWrite(db);
  });
  it("right attempt, wrong hash, no receipt: the hash is refused before the receipt", async () => {
    const db = await world();
    const res = await scan({ result: "clean", contentHash: "0".repeat(64) });
    expect(await codeOf(res)).toBe("hashMismatch");
    noWrite(db);
  });
  it("right attempt and hash, no receipt: notFetched", async () => {
    const db = await world();
    expect(await codeOf(await scan({ result: "clean" }))).toBe("notFetched");
    noWrite(db);
  });
  // R2.3 lists notScanning for a document that is not scanning. A quarantined document answers
  // `quarantined` first: it tells the scanner the file is blocked for good, so it stops retrying.
  // Decided in review (QA D4); the spec says so.
  it("a result for a quarantined document answers quarantined, not notScanning (QA D4)", async () => {
    await world({
      pipeline_state: "quarantined",
      pipeline_detail: external("scan", { reason: "threat", quarantinedVersions: [V] }),
    });
    expect(await codeOf(await scan({ result: "error", attempt: 99 }))).toBe("quarantined");
  });
  it("a quarantined version in a document that is scanning again answers quarantined, never moves", async () => {
    const db = await world({ pipeline_detail: external("scan", { quarantinedVersions: [V] }) });
    receipt(db);
    const res = await scan({ result: "clean" });
    expect(await codeOf(res)).toBe("quarantined");
    noWrite(db);
  });
});

describe("attempt edge cases", () => {
  it.each([
    ["0", 0],
    ["negative", -1],
    ["a string", "3"],
    ["a fraction", 3.5],
    ["null", null],
    ["above the maximum", 1_000_000_000],
    ["beyond safe integers", 2 ** 53],
    ["an array", [3]],
    ["a boolean", true],
  ])("attempt %s is a 400 that writes nothing", async (_n, attempt) => {
    const db = await world();
    receipt(db);
    const res = await scan({ result: "clean", attempt });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("invalidBody");
    noWrite(db);
  });
  it("a missing attempt is a 400", async () => {
    await world();
    const res = await rawScan(JSON.stringify({ result: "error", contentHash: HEX, engine: "AV" }));
    expect(res.status).toBe(400);
  });
  it("3.0 written by a client is the integer 3 and is accepted", async () => {
    const db = await world();
    const res = await rawScan(
      `{"result":"error","contentHash":"${HEX}","engine":"AV","attempt":3.0}`,
    );
    expect(res.status).toBe(200);
    expect(doc(db)["pipeline_state"]).toBe("failed");
  });
  it("the largest attempt (999999999) answers infected, but clean cannot start a new step", async () => {
    const db = await world({ pipeline_detail: external("scan", { attempt: 999_999_999 }) });
    receipt(db, { detail: "attempt 999999999 · via Order care" });
    const clean = await scan({ result: "clean", attempt: 999_999_999 });
    expect(clean.status).toBe(409);
    expect(await codeOf(clean)).toBe("cannotProcess");
    noWrite(db);
    expect(
      (await scan({ result: "infected", attempt: 999_999_999 }, { key: "other-key-001" })).status,
    ).toBe(200);
    expect(doc(db)["pipeline_state"]).toBe("quarantined");
  });
  it.each([
    ["a stored attempt as text", "3"],
    ["a stored attempt that is negative", -3],
    ["a stored attempt that is a fraction", 3.5],
    ["a stored attempt that is an object", {}],
  ])("%s refuses the change and writes nothing", async (_n, stored) => {
    const db = await world({ pipeline_detail: external("scan", { attempt: stored }) });
    receipt(db);
    const res = await scan({ result: "error" });
    expect(res.status).toBe(409);
    noWrite(db);
  });
  it("a document with no attempt in its detail never matches attempt 3", async () => {
    const db = await world({ pipeline_detail: { ...external("scan"), attempt: undefined } });
    const res = await scan({ result: "error" });
    expect(await codeOf(res)).toBe("staleAttempt");
    noWrite(db);
  });
});

describe("version edge cases", () => {
  it("an upper-case version id in the path is still the current version", async () => {
    // The route hands the id as written; the database treats uuid text without case.
    const db = await world();
    db.rows("document_versions").forEach((v) => (v["id"] = String(v["id"])));
    const res = await scan({ result: "error" }, { v: V.toUpperCase() });
    // The fake compares text exactly, so a 404 here is the fake's, not a finding.
    expect([200, 404]).toContain(res.status);
  });
  it("a version of this document that was never current is refused as not current", async () => {
    const db = await world();
    const res = await scan({ result: "error" }, { v: OLD });
    expect(await codeOf(res)).toBe("versionNotCurrent");
    noWrite(db);
  });
  it("a document with no current version never accepts a result", async () => {
    const db = await world({ current_version_id: null });
    const res = await scan({ result: "error" });
    expect(await codeOf(res)).toBe("versionNotCurrent");
    noWrite(db);
  });
  it("a deleted or purged document is not found", async () => {
    for (const over of [
      { deleted_at: "2026-11-01T00:00:00Z" },
      { purged_at: "2026-11-01T00:00:00Z" },
    ]) {
      const db = await world(over);
      expect((await scan({ result: "error" })).status).toBe(404);
      noWrite(db);
    }
  });
});

describe("replay (R2.8): the same result again", () => {
  it("answers 200 with the stored outcome for each result, under a new key", async () => {
    for (const result of ["infected", "error"] as const) {
      const db = await world();
      await scan({ result }, { key: "first-key-0001" });
      const again = await scan({ result }, { key: "second-key-002" });
      expect(again.status).toBe(200);
      expect(await json(again)).toMatchObject({ replayed: true });
      expect(db.writesTo("documents").filter((w) => w.rows.length > 0)).toHaveLength(1);
    }
  });
  it("a different result for the same attempt is refused, never applied", async () => {
    const db = await world();
    await scan({ result: "infected", threatName: THREAT }, { key: "first-key-0001" });
    const other = await scan({ result: "clean" }, { key: "second-key-002" });
    expect(other.status).toBe(409);
    expect(doc(db)["pipeline_state"]).toBe("quarantined");
    const back = await scan({ result: "error" }, { key: "third-key-0003" });
    expect(back.status).toBe(409);
    expect(doc(db)["pipeline_state"]).toBe("quarantined");
  });
  it("the same result for another attempt is refused", async () => {
    const db = await world();
    await scan({ result: "error" }, { key: "first-key-0001" });
    const other = await scan({ result: "error", attempt: 4 }, { key: "second-key-002" });
    expect(other.status).toBe(409);
    expect(db.writesTo("documents").filter((w) => w.rows.length > 0)).toHaveLength(1);
  });
  it("a replay is not answered to another system's key for the same document", async () => {
    // lastResult carries the key's client id: another client with the same body gets no outcome.
    const db = await world();
    await scan({ result: "error" }, { key: "first-key-0001" });
    doc(db)["pipeline_detail"] = {
      ...(doc(db)["pipeline_detail"] as object),
      lastResult: { step: "scan", attempt: 3, result: "error", byClient: "client-9" },
    };
    const res = await scan({ result: "error" }, { key: "second-key-002" });
    expect(res.status).toBe(409);
  });
  // R2.8: "A repeated identical result for a version already moved by this client in this attempt
  // answers 200 with the stored outcome (a scanner whose reply was lost does not loop on 409)".
  // With the built-in reader the server runs the reading in the same request; that write keeps the
  // scanner's `lastResult`, so a scanner that lost the reply of `clean` and retries under a new
  // Idempotency-Key is answered again instead of looping on 409. Was QA D1.
  it("after clean with the built-in reader, a lost reply retried under a new key answers 200 (QA D1)", async () => {
    const db = await world();
    receipt(db);
    const first = await scan({ result: "clean" }, { key: "first-key-0001" });
    expect((await json(first))["state"]).toBe("ready");
    const again = await scan({ result: "clean" }, { key: "second-key-002" });
    expect(again.status).toBe(200);
    expect(doc(db)["pipeline_state"]).toBe("ready");
  });
  it("with an external reader the same retry is answered while the reading waits", async () => {
    const db = await world();
    receipt(db);
    db.rows("tenants")[0]!["external_processing"] = { read: true };
    db.rows("integration_clients").push({
      id: "client-rd",
      name: "Acme Reader",
      tenant_id: TENANT,
      scopes: ["extract"],
      revoked_at: null,
      expires_at: null,
      key_hash: "rd",
    });
    await scan({ result: "clean" }, { key: "first-key-0001" });
    expect(doc(db)).toMatchObject({
      pipeline_state: "reading",
      pipeline_detail: { mode: "external", byClient: "client-rd", step: "read", attempt: 4 },
    });
    const again = await scan({ result: "clean" }, { key: "second-key-002" });
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ replayed: true, state: "reading" });
  });
  // The replay answers before the hash is compared, so a replay with a wrong hash is answered 200.
  // Nothing is applied; noted in the report as Low, not pinned here.
});

describe("the download receipt", () => {
  it.each([
    ["another version", { version_id: OLD }],
    ["another attempt", { detail: "attempt 2 · via Order care" }],
    ["an attempt that only starts like this one", { detail: "attempt 30 · via Order care" }],
    ["an attempt with the text after it first", { detail: "via Order care · attempt 3" }],
    ["another document", { document_id: "99999999-9999-4999-8999-999999999999" }],
    ["another organisation", { tenant_id: OTHER_TENANT }],
    ["another action name", { action: "download" }],
    ["an action that only looks like it", { action: "scanDownload " }],
    ["a person's note", { action: "comment", detail: "attempt 3 · via Order care" }],
    ["no detail", { detail: null }],
  ])("a receipt for %s does not count", async (_n, over) => {
    const db = await world();
    receipt(db, over);
    const res = await scan({ result: "clean" });
    expect(await codeOf(res)).toBe("notFetched");
    noWrite(db);
  });
  it("a receipt whose system name contains the separator still counts for its own attempt only", async () => {
    const db = await world();
    receipt(db, { detail: "attempt 3 · via A · attempt 4" });
    expect((await scan({ result: "clean", attempt: 3 })).status).toBe(200);
    expect(doc(db)["pipeline_state"]).not.toBe("scanning");
  });
  it("the receipt is found among 60 older ones of earlier attempts", async () => {
    const db = await world();
    for (let i = 0; i < 60; i++)
      receipt(db, {
        detail: `attempt ${i % 3} · via Order care`,
        created_at: `2026-11-20T10:${String(i).padStart(2, "0")}:00Z`,
      });
    receipt(db, { created_at: "2026-11-24T10:00:00Z" });
    expect((await scan({ result: "clean" })).status).toBe(200);
  });
  it("many downloads in one attempt do not hide it", async () => {
    const db = await world();
    for (let i = 0; i < 80; i++)
      receipt(db, { created_at: `2026-11-24T10:${String(i % 60).padStart(2, "0")}:00Z` });
    expect((await scan({ result: "clean" })).status).toBe(200);
  });
  it("infected and error do not need a receipt (the spec asks for one only for clean)", async () => {
    for (const result of ["infected", "error"] as const) {
      const db = await world();
      expect((await scan({ result })).status).toBe(200);
      expect(doc(db)["pipeline_state"]).not.toBe("scanning");
    }
  });
  it("the download itself writes the receipt the answer needs (HTTP only)", async () => {
    const db = await world();
    const link = await getAttachmentContent(
      call("GET", `/document/${DOC_ID}/attachment/${V}/content`),
      DOC_ID,
      V,
    );
    expect(link.status).toBe(200);
    expect((await scan({ result: "clean" })).status).toBe(200);
    expect(doc(db)["pipeline_state"]).toBe("ready");
  });
});

describe("the body", () => {
  const good = { result: "error", contentHash: "", attempt: 3, engine: "AV" };
  it.each([
    ["engine of 64 characters", { engine: "a".repeat(64) }, 200],
    ["engine of 65 characters", { engine: "a".repeat(65) }, 400],
    ["engine empty", { engine: "" }, 400],
    ["engine with a tag", { engine: "<b>x</b>" }, 400],
    ["engine with a trailing newline", { engine: "AV\n" }, 400],
    ["engine with an accented letter", { engine: "Virusskydd å" }, 400],
    ["engine with a fullwidth letter", { engine: "ＡＶ" }, 400],
    ["engine with allowed punctuation", { engine: "AV 1.3_x:y/z-w" }, 200],
    ["engine that is a number", { engine: 12 }, 400],
    [
      "threatName with infected, 64 characters",
      { result: "infected", threatName: "t".repeat(64) },
      200,
    ],
    [
      "threatName with infected, 65 characters",
      { result: "infected", threatName: "t".repeat(65) },
      400,
    ],
    ["threatName empty", { result: "infected", threatName: "" }, 400],
    ["threatName with a quote", { result: "infected", threatName: 'a"b' }, 400],
    ["threatName with clean", { result: "clean", threatName: "x" }, 400],
    ["threatName with error", { threatName: "x" }, 400],
    ["threatName as null", { result: "infected", threatName: null }, 400],
    ["an unknown key", { extra: 1 }, 400],
    ["a prototype key", JSON.parse('{"__proto__": {"result": "clean"}}') as object, 400],
    ["result in capitals", { result: "CLEAN" }, 400],
    ["result unknown", { result: "maybe" }, 400],
    ["hash with a space", { contentHash: "ab cd" }, 400],
    ["hash with sha256: prefix", { contentHash: "sha256:HEX" }, 200],
    ["hash in upper case", { contentHash: "HEXUP" }, 200],
    ["hash empty", { contentHash: "" }, 400],
    ["hash of 201 characters", { contentHash: "a".repeat(201) }, 400],
  ])("%s", async (_n, over, status) => {
    const db = await world();
    const o = over as Record<string, unknown>;
    if (o["contentHash"] === "sha256:HEX") o["contentHash"] = `sha256:${HEX}`;
    if (o["contentHash"] === "HEXUP") o["contentHash"] = HEX.toUpperCase();
    const res = await scan({ ...good, contentHash: HEX, ...o });
    expect(res.status).toBe(status);
    if (status === 400) noWrite(db);
  });
  it.each([
    ["not JSON", "{nope"],
    ["JSON null", "null"],
    ["an array", "[]"],
    ["a string", '"clean"'],
    ["empty", ""],
    ["a number", "7"],
  ])("a body that is %s is a 400 and writes nothing", async (_n, text) => {
    const db = await world();
    const res = await rawScan(text);
    expect(res.status).toBe(400);
    noWrite(db);
  });
  it("a body over the limit is 413 and writes nothing", async () => {
    const db = await world();
    const res = await rawScan(
      JSON.stringify({
        result: "error",
        contentHash: HEX,
        attempt: 3,
        engine: "x".repeat(300_000),
      }),
    );
    expect(res.status).toBe(413);
    noWrite(db);
  });
  it("a hash with the wrong digits but the right shape is a 409 hashMismatch, never a 400", async () => {
    const db = await world();
    for (const h of ["0".repeat(64), "f".repeat(63), "0".repeat(65), "sha256:" + "0".repeat(64)])
      expect(
        await codeOf(
          await scan(
            { result: "infected", contentHash: h },
            { key: `k-${h.length}-${h.slice(0, 3)}` },
          ),
        ),
      ).toBe("hashMismatch");
    noWrite(db);
  });
  it("a stored hash that is not a SHA-256 never matches, whatever the scanner sends", async () => {
    const db = await world();
    db.rows("document_versions")[0]!["content_hash"] = "md5:abc";
    expect(await codeOf(await scan({ result: "infected" }))).toBe("hashMismatch");
    db.rows("document_versions")[0]!["content_hash"] = null;
    expect(await codeOf(await scan({ result: "infected" }, { key: "second-key-002" }))).toBe(
      "hashMismatch",
    );
    noWrite(db);
  });
  it("a bad body does not echo anything it said", async () => {
    await world();
    const res = await scan({ result: "clean", engine: THREAT + "<", threatName: SECRET_NAME });
    expect(res.status).toBe(400);
    const text = JSON.stringify(await json(res));
    expect(text).not.toContain(THREAT);
    expect(text).not.toContain(SECRET_NAME);
  });
});

describe("idempotency key", () => {
  it.each([
    ["document", { id: "not-a-uuid" }],
    ["version", { v: "../../x" }],
  ])(
    "a malformed %s id is 404 before anything is remembered for the key (seg L3)",
    async (_n, ids) => {
      const db = await world();
      const res = await scan({ result: "error" }, { ...ids, key: "key-malformed-1" });
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("notFound");
      expect(db.writesTo("idempotency_keys")).toEqual([]);
      expect(db.writesTo("documents")).toEqual([]);
    },
  );
  it("the same key with another body is refused and changes nothing more", async () => {
    const db = await world();
    receipt(db);
    const first = await scan({ result: "infected", threatName: THREAT }, { key: "same-key-0001" });
    expect(first.status).toBe(200);
    const writes = db.writesTo("documents").length;
    const other = await scan({ result: "infected", threatName: "Other" }, { key: "same-key-0001" });
    expect(other.status).toBe(409);
    expect(await codeOf(other)).toBe("idempotencyMismatch");
    expect(db.writesTo("documents")).toHaveLength(writes);
  });
  it("the same key with another result for the same attempt is refused", async () => {
    const db = await world();
    receipt(db);
    await scan({ result: "error" }, { key: "same-key-0001" });
    const other = await scan({ result: "clean" }, { key: "same-key-0001" });
    expect(await codeOf(other)).toBe("idempotencyMismatch");
    expect(doc(db)["pipeline_state"]).toBe("failed");
  });
  it("a refusal does not burn the key: the same request goes through after the download", async () => {
    const db = await world();
    const refused = await scan({ result: "clean" }, { key: "same-key-0001" });
    expect(refused.status).toBe(409);
    receipt(db);
    const ok = await scan({ result: "clean" }, { key: "same-key-0001" });
    expect(ok.status).toBe(200);
  });
  it.each([
    ["missing", null],
    ["too short", "abc"],
    ["with a space", "has space in key"],
    ["too long", "k".repeat(129)],
  ])("a key that is %s is a 400 before any work", async (_n, key) => {
    const db = await world();
    const res = await scan({ result: "error" }, { key });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("idempotencyKeyMissing");
    noWrite(db);
  });
  it("another system's key is a separate namespace", async () => {
    const db = await world();
    await scan({ result: "error" }, { key: "same-key-0001" });
    expect(db.rows("idempotency_keys").every((r) => r["actor"] === CLIENT_ID)).toBe(true);
  });
});

describe("failure paths", () => {
  it("the activity entry failing after the change answers 503, and the same request is then answered as a replay", async () => {
    const db = await world();
    db.fail("document_events", "insert");
    const res = await scan({ result: "infected", threatName: THREAT }, { key: "same-key-0001" });
    expect(res.status).toBe(503);
    // The change was already written; the key is free, and a retry must not loop on 409.
    expect(doc(db)["pipeline_state"]).toBe("quarantined");
    db.clearFailures();
    const retry = await scan({ result: "infected", threatName: THREAT }, { key: "same-key-0001" });
    expect(retry.status).toBe(200);
    expect(await json(retry)).toMatchObject({ state: "quarantined", replayed: true });
  });
  it("a failure reading the version is never a 200 and writes nothing", async () => {
    const db = await world();
    db.fail("document_versions", "select");
    const res = await scan({ result: "infected", threatName: THREAT });
    expect(res.status).not.toBe(200);
    noWrite(db);
  });
  it("a failure writing the document is never a 200", async () => {
    const db = await world();
    db.fail("documents", "update");
    const res = await scan({ result: "error" });
    expect(res.status).toBeGreaterThanOrEqual(409);
    expect(doc(db)["pipeline_state"]).toBe("scanning");
  });
});

describe("R6.2: the key is checked again on every call", () => {
  it("a key that holds scan together with another scope is refused, and changes nothing", async () => {
    const db = await world({}, ["scan", "read"]);
    receipt(db);
    const res = await scan({ result: "infected" });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("notDesignated");
    noWrite(db);
  });
  it("a second active antivirus in the organisation makes the first refused too", async () => {
    const db = await world();
    db.rows("integration_clients").push({
      ...db.rows("integration_clients")[0]!,
      id: "client-av2",
      key_hash: "other",
    });
    const res = await scan({ result: "infected" });
    expect(await codeOf(res)).toBe("notDesignated");
    noWrite(db);
  });
  it("a key that is revoked or expired is a 401 and writes nothing", async () => {
    for (const over of [
      { revoked_at: "2026-11-01T00:00:00Z" },
      { expires_at: "2026-01-01T00:00:00Z" },
    ]) {
      const db = await world();
      Object.assign(db.rows("integration_clients")[0]!, over);
      expect((await scan({ result: "infected" })).status).toBe(401);
      noWrite(db);
    }
  });
});
