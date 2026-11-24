// QA, adversarial: the reader's answer (extractionResult). Field checks at the limits, names, types,
// dates, enums, bands, a person's existing row, body size, replay, idempotency and logs.
// Tests that expose a real defect are `it.fails` with the defect named above them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postExtractionResult } from "@/test/gateway-api";
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
const SECRET_VALUE = "SEK 48,000,000 QA";
const SECRET_NAME = "Merger plan Aurora QA.pdf";
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
  for (const s of [SECRET_VALUE, SECRET_NAME]) expect(logs.join("\n")).not.toContain(s);
});
const external = (over: Record<string, unknown> = {}) => ({
  mode: "external",
  by: "Order care",
  byClient: CLIENT_ID,
  step: "read",
  attempt: 3,
  quarantinedVersions: [],
  ...over,
});
const SPECS = [
  {
    code: "contract",
    definition: {
      specCharacteristic: [
        { name: "amount", valueType: "string" },
        { name: "plain" },
        { name: "pages", valueType: "number" },
        { name: "signedOn", valueType: "date" },
        { name: "kind", valueType: "enum", enumValues: ["NDA", "MSA"] },
        { name: "signed", valueType: "boolean" },
        { name: "odd", valueType: "currency" },
        { name: "strict", valueType: "string", reviewThreshold: 0.95 },
        { name: "lax", valueType: "string", reviewThreshold: 0.5 },
        { name: "pct", valueType: "string", reviewThreshold: 95 },
        { name: "one", valueType: "string", reviewThreshold: 1 },
        ...Array.from({ length: 120 }, (_v, i) => ({ name: `f${i}`, valueType: "string" })),
      ],
    },
  },
];
async function world(doc: Record<string, unknown> = {}, scopes = ["extract"]) {
  const db = await buildWorld({
    scopes,
    specs: SPECS,
    documents: [
      docRow({
        name: SECRET_NAME,
        current_version_id: V,
        pipeline_state: "reading",
        pipeline_detail: external(),
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
    content_hash: "sha256:" + "a".repeat(64),
    size_bytes: 10,
  }));
  // Proposals get ids as the database default would: the take-back deletes by id.
  db.withAutoId("extraction_fields");
  return db;
}
const read = (body: Record<string, unknown>, key?: string, v = V) =>
  postExtractionResult(
    call("POST", `/document/${DOC_ID}/attachment/${v}/extractionResult`, {
      body: { attempt: 3, ...body },
      ...(key ? { idempotencyKey: key } : {}),
    }),
    DOC_ID,
    v,
  );
const rawRead = (text: string) =>
  postExtractionResult(
    new Request(`${BASE}/document/${DOC_ID}/attachment/${V}/extractionResult`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        "idempotency-key": IDEM_KEY,
        "content-type": "application/json",
      },
      body: text,
    }),
    DOC_ID,
    V,
  );
const f = (name: string, value: unknown, confidence = 0.95, extra: object = {}) => ({
  name,
  value,
  confidence,
  ...extra,
});
const doc = (db: FakeDb) => db.rows("documents").find((d) => d["id"] === DOC_ID)!;
const untouched = (db: FakeDb) => {
  expect(db.writesTo("documents").filter((w) => w.rows.length > 0)).toEqual([]);
  expect(db.rows("extraction_fields")).toEqual([]);
};
const codeOf = async (res: Response) => (await json(res))["code"];

describe("R3.2: the same check order as a scan", () => {
  const bad = { result: "read", attempt: 99, fields: [f("nonsense", "x")] };
  it.each([
    [
      "unknown document",
      { pipeline_state: "reading" },
      "55555555-5555-4555-8555-555555555555",
      404,
      "notFound",
    ],
    ["an older version", {}, OLD, 409, "versionNotCurrent"],
    ["not reading", { pipeline_state: "ready" }, V, 409, "notReading"],
    [
      "a built-in reading",
      { pipeline_detail: external({ mode: "simulated" }) },
      V,
      409,
      "notReading",
    ],
    [
      "another system's step",
      { pipeline_detail: external({ byClient: "client-9" }) },
      V,
      409,
      "notYourStep",
    ],
    ["a stale attempt with bad fields", {}, V, 409, "staleAttempt"],
  ])("%s wins over the bad fields", async (_n, over, v, status, code) => {
    const db = await world(over);
    const res = await postExtractionResult(
      call(
        "POST",
        `/document/${v === V || v === OLD ? DOC_ID : v}/attachment/${v}/extractionResult`,
        { body: bad },
      ),
      v === V || v === OLD ? DOC_ID : v,
      v,
    );
    expect(res.status).toBe(status);
    expect(await codeOf(res)).toBe(code);
    untouched(db);
  });
  it("another organisation's document is the same 404", async () => {
    const db = await world({ tenant_id: OTHER_TENANT });
    const res = await read(bad);
    expect(res.status).toBe(404);
    untouched(db);
  });
  it("a scanning document is refused to its reader even with good fields", async () => {
    const db = await world({
      pipeline_state: "scanning",
      pipeline_detail: external({ step: "scan" }),
    });
    expect(await codeOf(await read({ result: "read", fields: [f("amount", "x")] }))).toBe(
      "notReading",
    );
    untouched(db);
  });
});

describe("fields at the limits", () => {
  it("exactly 100 fields are accepted", async () => {
    const db = await world();
    const fields = Array.from({ length: 100 }, (_v, i) => f(`f${i}`, `v${i}`));
    const res = await read({ result: "read", fields });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ state: "ready", proposed: 100 });
    expect(db.rows("extraction_fields")).toHaveLength(100);
  });
  it("101 fields refuse all of them", async () => {
    const db = await world();
    const res = await read({
      result: "read",
      fields: Array.from({ length: 101 }, (_v, i) => f(`f${i}`, `v${i}`)),
    });
    expect(res.status).toBe(400);
    untouched(db);
  });
  it("100 fields of 2000 characters fit in the body limit", async () => {
    const db = await world();
    const fields = Array.from({ length: 100 }, (_v, i) => f(`f${i}`, "x".repeat(2000)));
    const res = await read({ result: "read", fields });
    expect(res.status).toBe(200);
    expect(db.rows("extraction_fields")).toHaveLength(100);
  });
  it("a body of exactly 1000000 bytes is read, one more byte is 413", async () => {
    const base = JSON.stringify({ result: "read", attempt: 3, fields: [] });
    const pad = (n: number) =>
      JSON.stringify({ result: "read", attempt: 3, fields: [], ...{} }).slice(0, -1) +
      " ".repeat(n) +
      "}";
    const exact = pad(1_000_000 - base.length);
    expect(new TextEncoder().encode(exact).length).toBe(1_000_000);
    const db = await world();
    expect((await rawRead(exact)).status).toBe(200);
    expect(doc(db)["pipeline_state"]).toBe("ready");
    const db2 = await world();
    expect((await rawRead(pad(1_000_001 - base.length))).status).toBe(413);
    expect(db2.writesTo("documents")).toEqual([]);
  });
  // R3.3: at most 100 fields of at most 2000 code points. The limit counts bytes, so it leaves room
  // for 100 values of 2000 Japanese characters (3 bytes each, 600 KB). Was QA D3.
  it("100 fields of 2000 non-Latin characters fit in the body limit (QA D3)", async () => {
    const db = await world();
    const fields = Array.from({ length: 100 }, (_v, i) => f(`f${i}`, "あ".repeat(2000)));
    const res = await read({ result: "read", fields });
    expect(res.status).toBe(200);
    expect(db.rows("extraction_fields")).toHaveLength(100);
  });
  it("read with an empty list is ready, and unreadable is failed", async () => {
    const db = await world();
    expect(await json(await read({ result: "read", fields: [] }))).toMatchObject({
      state: "ready",
      proposed: 0,
    });
    expect(doc(db)["pipeline_state"]).toBe("ready");
    const db2 = await world();
    await read({ result: "unreadable" });
    expect(doc(db2)).toMatchObject({
      pipeline_state: "failed",
      pipeline_detail: { reason: "unreadable" },
    });
  });
  it("read with no `fields` key is refused (pins today's behaviour; R3.5 says read even with no fields)", async () => {
    const db = await world();
    expect((await read({ result: "read" })).status).toBe(400);
    untouched(db);
  });
  it("fields with unreadable are refused", async () => {
    const db = await world();
    expect((await read({ result: "unreadable", fields: [] })).status).toBe(400);
    expect((await read({ result: "unreadable", fields: [f("amount", "x")] })).status).toBe(400);
    untouched(db);
  });
});

describe("names", () => {
  it.each([
    ["unknown", [f("nonsense", "x")], "unknownFields"],
    ["different case", [f("Amount", "x")], "unknownFields"],
    ["with a trailing space", [f("amount ", "x")], "unknownFields"],
    ["with a lookalike letter", [f("amοunt", "x")], "unknownFields"],
    ["the prototype name", [f("__proto__", "x")], "unknownFields"],
    ["the constructor name", [f("constructor", "x")], "unknownFields"],
    ["a duplicate", [f("amount", "a"), f("amount", "b")], "duplicateFields"],
    [
      "a duplicate after an unknown one is still the unknown",
      [f("nope", "a"), f("amount", "a"), f("amount", "b")],
      "unknownFields",
    ],
  ])("%s refuses the whole answer", async (_n, fields, code) => {
    const db = await world();
    const res = await read({ result: "read", fields: [f("plain", "ok"), ...fields] });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe(code);
    untouched(db);
  });
  it("an empty name and a name of 201 code points are 400 before any lookup", async () => {
    const db = await world();
    expect((await read({ result: "read", fields: [f("", "x")] })).status).toBe(400);
    expect((await read({ result: "read", fields: [f("n".repeat(201), "x")] })).status).toBe(400);
    untouched(db);
  });
  it("an unknown name is listed with unsafe characters replaced and cut at 64", async () => {
    await world();
    const res = await read({
      result: "read",
      fields: [f("evil\u202Ename" + "x".repeat(100), "v")],
    });
    const names = (await json(res))["names"] as string[];
    expect(names[0]).not.toContain("\u202E");
    expect([...names[0]!].length).toBeLessThanOrEqual(64);
  });
  it("at most 20 unknown names are listed", async () => {
    await world();
    const res = await read({
      result: "read",
      fields: Array.from({ length: 50 }, (_v, i) => f(`zz${i}`, "v")),
    });
    expect(((await json(res))["names"] as string[]).length).toBe(20);
  });
  // R3.3: "unknown names refused with 400 listing them, escaped". Decided in review (QA D6): escaped
  // means JSON-encoded, with unsafe characters replaced and the name cut; the answer is JSON only
  // (nosniff), and the screens show these names as text, never as markup.
  it("an unknown name with markup comes back inside JSON that is never sniffed as HTML (QA D6)", async () => {
    await world();
    const res = await read({ result: "read", fields: [f("<img src=x onerror=alert(1)>", "v")] });
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await json(res))["names"]).toEqual(["<img src=x onerror=alert(1)>"]);
  });
  it("the answer never repeats a value", async () => {
    await world();
    const res = await read({
      result: "read",
      fields: [f("amount", SECRET_VALUE), f("nonsense", SECRET_VALUE)],
    });
    expect(JSON.stringify(await json(res))).not.toContain(SECRET_VALUE);
  });
});

describe("value types", () => {
  const ok = (name: string, value: unknown) => [name, value, 200] as const;
  const no = (name: string, value: unknown) => [name, value, 400] as const;
  it.each([
    ok("amount", ""),
    ok("amount", "a".repeat(2000)),
    no("amount", "a".repeat(2001)),
    ok("amount", "😀".repeat(2000)),
    no("amount", "😀".repeat(2001)),
    no("amount", "line\nbreak"),
    no("amount", "tab\there"),
    no("amount", "nul\u0000x"),
    no("amount", "c1\u0085x"),
    no("amount", "bidi\u202Ex"),
    no("amount", "iso\u2066x"),
    no("amount", "zws\u200Bx"),
    no("amount", "bom\uFEFFx"),
    no("amount", "sep\u2028x"),
    no("amount", "lone\uD800x"),
    no("amount", "tag\u{E0041}x"),
    no("amount", "fill\u3164x"),
    ok("amount", "zwj\u200Dx"),
    ok("amount", "Örebro, Västerås, Åsa"),
    no("amount", 5),
    no("amount", null),
    no("amount", true),
    no("amount", { a: 1 }),
    no("amount", ["x"]),
    ok("plain", "no type means string"),
    no("plain", 1),
    ok("pages", 0),
    ok("pages", -3.5),
    ok("pages", 1e308),
    no("pages", "12"),
    no("pages", "NaN"),
    no("pages", null),
    no("pages", true),
    ok("signed", false),
    no("signed", "true"),
    no("signed", 0),
    ok("signedOn", "2024-02-29"),
    no("signedOn", "2023-02-29"),
    no("signedOn", "2026-02-30"),
    no("signedOn", "2026-13-01"),
    no("signedOn", "2026-00-10"),
    no("signedOn", "2026-1-1"),
    no("signedOn", "2026-01-01T00:00:00Z"),
    no("signedOn", " 2026-01-01"),
    no("signedOn", "2026-01-01\n"),
    no("signedOn", "01/02/2026"),
    no("signedOn", 20260101),
    ok("signedOn", "0001-01-01"),
    ok("signedOn", "9999-12-31"),
    ok("kind", "NDA"),
    no("kind", "nda"),
    no("kind", "NDA "),
    no("kind", "OTHER"),
    no("kind", 1),
    no("odd", "anything"),
  ])("%s = %j gives %i", async (name, value, status) => {
    const db = await world();
    const res = await read({ result: "read", fields: [f(name, value)] });
    expect(res.status).toBe(status);
    if (status === 400) untouched(db);
    else expect(db.rows("extraction_fields")).toHaveLength(1);
  });
  it.each([
    ["null", null],
    ["an object", { a: 1 }],
    ["a list", ["x"]],
    ["deeply nested lists", JSON.parse("[".repeat(5000) + "]".repeat(5000)) as unknown],
  ])(
    "a value that is %s is refused as the wrong shape, before anything is hashed or stored (seg L2)",
    async (_n, value) => {
      const db = await world();
      const res = await read({ result: "read", fields: [f("amount", value)] });
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalidBody");
      untouched(db);
      expect(db.rows("idempotency_keys") ?? []).toEqual([]);
    },
  );
  it("one bad value among good ones refuses all, and the document stays reading", async () => {
    const db = await world();
    const res = await read({
      result: "read",
      fields: [f("amount", SECRET_VALUE), f("pages", "x"), f("signed", true)],
    });
    const answer = await json(res);
    expect(answer["code"]).toBe("badValues");
    expect(JSON.stringify(answer)).not.toContain(SECRET_VALUE);
    expect(doc(db)["pipeline_state"]).toBe("reading");
    untouched(db);
  });
});

describe("confidence and band", () => {
  const band = async (name: string, confidence: number) => {
    const db = await world();
    const res = await read({ result: "read", fields: [f(name, "v", confidence)] });
    return res.status === 200 ? db.rows("extraction_fields")[0]!["band"] : res.status;
  };
  it.each([
    ["amount", 1, "high"],
    ["amount", 0.9, "high"],
    ["amount", 0.8999999, "medium"],
    ["amount", 0.7, "medium"],
    ["amount", 0.6999999, "low"],
    ["amount", 0, "low"],
    ["strict", 0.92, "medium"],
    ["strict", 0.95, "high"],
    ["lax", 0.85, "medium"],
    ["lax", 0.9, "high"],
    ["pct", 0.9, "high"],
    ["one", 0.99, "medium"],
    ["one", 1, "high"],
    ["amount", -0.0001, 400],
    ["amount", 1.0001, 400],
    ["amount", 95, 400],
  ])("%s at %s is %s", async (name, c, expected) => {
    expect(await band(name, c)).toBe(expected);
  });
  it("a confidence sent as text, null or missing is refused", async () => {
    const db = await world();
    for (const confidence of ["0.9", null, undefined, [0.9]])
      expect(
        (await read({ result: "read", fields: [{ name: "amount", value: "x", confidence }] }))
          .status,
      ).toBe(400);
    untouched(db);
  });
  it("a number too large for JSON (1e999) reads as infinity and is refused", async () => {
    const db = await world();
    const res = await rawRead(
      `{"result":"read","attempt":3,"fields":[{"name":"amount","value":"x","confidence":1e999}]}`,
    );
    expect(res.status).toBe(400);
    untouched(db);
  });
});

describe("source", () => {
  it.each([
    ["page 2: table 1", 200],
    ["", 200],
    ["a".repeat(64), 200],
    ["a".repeat(65), 400],
    ["https://evil.example/x", 400],
    ["http://x", 400],
    ["//evil.example/x", 400],
    ["www.evil.example", 400],
    ["WWW.EVIL.EXAMPLE", 400],
    ["page 2\n", 400],
    ["<b>x</b>", 400],
    ["javascript:alert(1)", 400],
    // The spec's own pattern is ASCII-only: a Swedish label is refused (pins the spec, R3.3).
    ["sida å 2", 400],
  ])("%j gives %i", async (source, status) => {
    const db = await world();
    const res = await read({ result: "read", fields: [f("amount", "v", 0.95, { source })] });
    expect(res.status).toBe(status);
    if (status === 400) untouched(db);
  });
  it("a source that is not text is refused; none is stored as no label", async () => {
    const db = await world();
    expect(
      (await read({ result: "read", fields: [f("amount", "v", 0.95, { source: 5 })] })).status,
    ).toBe(400);
    await read({ result: "read", fields: [f("amount", "v")] });
    expect(
      (db.rows("extraction_fields")[0]!["source"] as Record<string, unknown>)["label"],
    ).toBeUndefined();
  });
  it("an unknown key inside a field is refused", async () => {
    const db = await world();
    expect(
      (await read({ result: "read", fields: [f("amount", "v", 0.95, { status: "accepted" })] }))
        .status,
    ).toBe(400);
    untouched(db);
  });
});

describe("R3.4: only proposals, and a person's row stays", () => {
  it.each(["pending", "accepted", "edited", "rejected"])(
    "a row of this version in status %s is kept and the detail skipped",
    async (status) => {
      const db = await world();
      db.rows("extraction_fields").push({
        name: "amount",
        value: "person",
        version_id: V,
        document_id: DOC_ID,
        tenant_id: TENANT,
        status,
      });
      const res = await read({ result: "read", fields: [f("amount", "system"), f("plain", "p")] });
      expect(await json(res)).toMatchObject({ proposed: 1, skipped: ["amount"] });
      expect(db.rows("extraction_fields").find((r) => r["name"] === "amount")).toMatchObject({
        value: "person",
        status,
      });
    },
  );
  it("a row of another version, another document or another organisation does not block it", async () => {
    const db = await world();
    const base = { name: "amount", status: "edited", value: "x" };
    db.rows("extraction_fields").push(
      { ...base, version_id: OLD, document_id: DOC_ID, tenant_id: TENANT },
      { ...base, version_id: V, document_id: "other-doc", tenant_id: TENANT },
      { ...base, version_id: V, document_id: DOC_ID, tenant_id: OTHER_TENANT },
    );
    const res = await read({ result: "read", fields: [f("amount", "system")] });
    expect(await json(res)).toMatchObject({ proposed: 1, skipped: [] });
  });
  it("every stored row is pending, from the system, in this tenant, and the document is untouched but for its state", async () => {
    const db = await world();
    await read({
      result: "read",
      fields: [f("amount", SECRET_VALUE, 0.4), f("pages", 3), f("signed", true, 1)],
    });
    for (const r of db.rows("extraction_fields"))
      expect(r).toMatchObject({
        status: "pending",
        tenant_id: TENANT,
        document_id: DOC_ID,
        version_id: V,
        source: { system: CLIENT_ID, systemName: "Order care" },
      });
    expect(doc(db)["characteristic"]).toEqual({});
    expect(JSON.stringify(db.rows("document_events"))).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(doc(db)["pipeline_detail"])).not.toContain(SECRET_VALUE);
  });
  it("a system name with a bidi mark is stored cleaned", async () => {
    const db = await world();
    db.rows("integration_clients")[0]!["name"] = "Evil\u202Egnp";
    await read({ result: "read", fields: [f("amount", "v")] });
    expect(JSON.stringify(db.rows("extraction_fields"))).not.toContain("\\u202e");
  });
  it("two details racing for one step: the loser writes no document change and takes its rows back", async () => {
    const db = await world();
    db.stubNextSelect("documents", [{ ...doc(db) }]);
    doc(db)["pipeline_detail"] = external({ attempt: 4 });
    const res = await read({ result: "read", fields: [f("amount", "v")] });
    expect(await codeOf(res)).toBe("changedMeanwhile");
    expect(db.rows("extraction_fields")).toEqual([]);
  });
  // R2.9/R3: when the take-back itself fails, the loser's proposed details stay behind although the
  // document did not move. They cannot be removed then, so the log names the rows (ids only, never a
  // value) for a person to reject. Was QA D7.
  it("a failed take-back is logged with the row ids, never a value (QA D7)", async () => {
    const db = await world();
    db.stubNextSelect("documents", [{ ...doc(db) }]);
    doc(db)["pipeline_detail"] = external({ attempt: 4 });
    db.fail("extraction_fields", "delete");
    const logged: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((m: unknown) => void logged.push(String(m)));
    try {
      const res = await read({ result: "read", fields: [f("amount", SECRET_VALUE)] });
      expect(await codeOf(res)).toBe("changedMeanwhile");
    } finally {
      spy.mockRestore();
    }
    const row = db.rows("extraction_fields")[0]!;
    expect(logged.join("\n")).toContain("takeBackFields");
    expect(logged.join("\n")).toContain(String(row["id"]));
    expect(logged.join("\n")).not.toContain(SECRET_VALUE);
  });
  it("a failure writing the details answers 503 and moves nothing", async () => {
    const db = await world();
    db.fail("extraction_fields", "insert");
    const res = await read({ result: "read", fields: [f("amount", SECRET_VALUE)] });
    expect(res.status).toBe(503);
    expect(doc(db)["pipeline_state"]).toBe("reading");
  });
});

describe("the type's details", () => {
  it("a document type with no specification refuses every name but takes an empty answer", async () => {
    const db = await world({ document_type: "unknown-type" });
    expect(await codeOf(await read({ result: "read", fields: [f("amount", "v")] }))).toBe(
      "unknownFields",
    );
    expect((await read({ result: "read", fields: [] }, "second-key-002")).status).toBe(200);
    expect(doc(db)["pipeline_state"]).toBe("ready");
  });
  // When the specification cannot be read (the database answers an error), the reader is told to
  // retry, not that every name is unknown. Was QA D2.
  it("an error reading the specifications answers 503, not 400 unknownFields (QA D2)", async () => {
    const db = await world();
    delete (db as unknown as { rpcs: Record<string, unknown> }).rpcs["effective_specifications"];
    const res = await read({ result: "read", fields: [f("amount", "v")] });
    expect(res.status).toBe(503);
  });
  it("characteristics that are not objects or have no name are ignored, not fatal", async () => {
    const db = await world();
    db.onRpc("effective_specifications", [
      {
        code: "contract",
        definition: { specCharacteristic: [null, 5, "x", {}, { name: 7 }, { name: "amount" }] },
      },
    ]);
    expect((await read({ result: "read", fields: [f("amount", "v")] })).status).toBe(200);
  });
  it("a specification with no characteristic list or a bad one refuses names", async () => {
    for (const def of [{}, { specCharacteristic: "x" }, null]) {
      const db = await world();
      db.onRpc("effective_specifications", [{ code: "contract", definition: def }]);
      expect((await read({ result: "read", fields: [f("amount", "v")] })).status).toBe(400);
    }
  });
});

describe("replay and idempotency", () => {
  it("the same answer under a new key is answered as a replay and adds no rows", async () => {
    const db = await world();
    await read({ result: "read", fields: [f("amount", "v")] }, "first-key-0001");
    const again = await read({ result: "read", fields: [f("amount", "v")] }, "second-key-002");
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ replayed: true, state: "ready" });
    expect(db.rows("extraction_fields")).toHaveLength(1);
  });
  it("the same key with other fields is refused and adds no rows", async () => {
    const db = await world();
    await read({ result: "read", fields: [f("amount", "v")] }, "same-key-0001");
    const other = await read(
      { result: "read", fields: [f("amount", "w"), f("plain", "z")] },
      "same-key-0001",
    );
    expect(await codeOf(other)).toBe("idempotencyMismatch");
    expect(db.rows("extraction_fields")).toHaveLength(1);
  });
  it("unreadable after read for the same attempt is refused", async () => {
    const db = await world();
    await read({ result: "read", fields: [] }, "first-key-0001");
    const other = await read({ result: "unreadable" }, "second-key-002");
    expect(other.status).toBe(409);
    expect(doc(db)["pipeline_state"]).toBe("ready");
  });
  it("a reading answered after the reader's key lost its scope is a 403 and writes nothing", async () => {
    const db = await world({}, ["scan"]);
    expect((await read({ result: "read", fields: [] })).status).toBe(403);
    untouched(db);
  });
  it.each([["read"], ["register"], ["hold"], ["delete"]])(
    "a %s key cannot answer a reading",
    async (scope) => {
      await world({}, [scope]);
      expect((await read({ result: "read", fields: [] })).status).toBe(403);
    },
  );
});

describe("R6.3: the write allowance", () => {
  it("a 429 changes nothing and adds no detail", async () => {
    const db = await buildWorld({
      scopes: ["extract"],
      specs: SPECS,
      hits: 31,
      documents: [
        docRow({ current_version_id: V, pipeline_state: "reading", pipeline_detail: external() }),
      ],
    });
    const res = await read({ result: "read", fields: [f("amount", "v")] });
    expect(res.status).toBe(429);
    untouched(db);
  });
});
