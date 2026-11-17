// Characterisation of registering a document through the TMF gateway (POST /document) and of the
// short-lived download link (GET /document/{id}/attachment/{id}/content).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWorld,
  call,
  CLIENT_ID,
  DOC_ID,
  docRow,
  json,
  OTHER_TENANT,
  TENANT,
} from "@/test/gateway-world";
import { createDocument, getAttachmentContent } from "@/test/gateway-api";
import { sha256Hex } from "@/services/tmf667-mapper";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type FakeDbLike = Awaited<ReturnType<typeof world>>;
const ENTITY = "ent-1";
const spec = (def: Record<string, unknown> = {}) => ({
  code: "contract",
  name: "Contract",
  definition: { category: "Legal", ...def },
});
const TEXT = "hello contract";
const INLINE = btoa(TEXT);
const attachment = (over: Record<string, unknown> = {}) => ({
  mimeType: "application/pdf",
  content: INLINE,
  ...over,
});
const body = (over: Record<string, unknown> = {}) => ({
  name: "Signed contract",
  documentType: "contract",
  relatedEntity: [{ id: ENTITY, role: "contract" }],
  attachment: attachment(),
  ...over,
});
async function world(def: Record<string, unknown> = {}) {
  const db = await buildWorld({ documents: [], specs: [spec(def)] });
  db.tables["business_entities"] = [
    { id: ENTITY, tenant_id: TENANT },
    { id: "ent-other", tenant_id: OTHER_TENANT },
  ];
  return db;
}
const create = (over: Record<string, unknown> = {}, opts: Parameters<typeof call>[2] = {}) =>
  createDocument(call("POST", "/document", { body: body(over), ...opts }));
const code = async (res: Response) => (await json(res))["code"];

describe("registering a document with inline content", () => {
  it("stores the file, the first version and the links, and answers 201 with the document", async () => {
    const db = await world({ defaultSensitivity: "confidential", retentionPolicyRef: "pol-7" });
    const res = await create();
    expect(res.status).toBe(201);
    const doc = await json(res);
    expect(doc).toMatchObject({ name: "Signed contract", "@type": "EradDocument" });
    expect(doc["uploadUrl"]).toBeUndefined();

    const [row] = db.rows("documents");
    expect(row).toMatchObject({
      tenant_id: TENANT,
      name: "Signed contract",
      document_type: "contract",
      status: "draft",
      pipeline_state: "ready",
      sensitivity: "confidential",
      retention_policy_id: "pol-7",
      origin: "uploaded",
      registered_by_client: CLIENT_ID,
    });
    const [version] = db.rows("document_versions");
    expect(version).toMatchObject({
      document_id: row?.["id"],
      tenant_id: TENANT,
      label: "1",
      mime_type: "application/pdf",
      size_bytes: TEXT.length,
      content_hash: await sha256Hex(TEXT),
    });
    expect(row?.["current_version_id"]).toBe(version?.["id"]);
    expect(version?.["storage_path"]).toBe(`${TENANT}/${version?.["id"]}`);
    expect(db.rows("document_relations")).toMatchObject([
      { document_id: row?.["id"], entity_id: ENTITY, role: "contract" },
    ]);
    expect(db.storageCalls).toHaveLength(1);
    expect(db.storageCalls[0]).toMatchObject({
      bucket: "documents",
      op: "upload",
      path: version?.["storage_path"],
      contentType: "application/pdf",
    });
    expect(new TextDecoder().decode(db.storageCalls[0]?.bytes)).toBe(TEXT);
    expect(db.rows("document_events")).toMatchObject([
      { action: "upload", detail: "Version 1 (sent inline) · via Order care" },
    ]);
  });

  it("defaults the sensitivity to internal and keeps external identifiers and characteristics", async () => {
    const db = await world();
    await create({
      externalIdentifier: [{ id: "CRM-9", owner: "crm" }],
      characteristic: [{ name: "counterparty", value: "Acme" }],
    });
    expect(db.rows("documents")[0]).toMatchObject({
      sensitivity: "internal",
      retention_policy_id: null,
      external_identifier: [{ id: "CRM-9", owner: "crm" }],
      characteristic: [{ name: "counterparty", value: "Acme" }],
    });
  });

  it("takes the attachment as a one-item array as well as a single object", async () => {
    await world();
    expect((await create({ attachment: [attachment()] })).status).toBe(201);
  });

  it("accepts a contentHash that matches the bytes", async () => {
    await world();
    const res = await create({ attachment: attachment({ contentHash: await sha256Hex(TEXT) }) });
    expect(res.status).toBe(201);
  });

  it("refuses 422 hashMismatch when the bytes are not the ones named, and stores nothing", async () => {
    const db = await world();
    const res = await create({ attachment: attachment({ contentHash: "a".repeat(64) }) });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe("hashMismatch");
    expect(db.rows("documents")).toEqual([]);
    expect(db.storageCalls).toEqual([]);
  });

  it("refuses 400 invalidContent for content that is not base64", async () => {
    await world();
    const res = await create({ attachment: attachment({ content: "***not base64***" }) });
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("invalidContent");
  });

  it("accepts inline content of exactly 5 MB", async () => {
    await world();
    const exact = btoa("a".repeat(5 * 1024 * 1024));
    expect((await create({ attachment: attachment({ content: exact }) })).status).toBe(201);
  });

  it("refuses 413 tooLarge for inline content over 5 MB", async () => {
    const db = await world();
    const big = btoa("a".repeat(5 * 1024 * 1024 + 1));
    const res = await create({ attachment: attachment({ content: big }) });
    expect(res.status).toBe(413);
    expect(await code(res)).toBe("tooLarge");
    expect(db.rows("documents")).toEqual([]);
  });
});

describe("registering a document without content", () => {
  it("answers an upload address and leaves the document waiting for the file", async () => {
    const db = await world();
    const res = await create({
      attachment: { mimeType: "application/pdf", contentHash: "b".repeat(64), size: 1234 },
    });
    expect(res.status).toBe(201);
    const doc = await json(res);
    const [version] = db.rows("document_versions");
    expect(doc["uploadUrl"]).toBe(
      `https://storage.example/documents/${version?.["storage_path"]}?token=t`,
    );
    expect(db.rows("documents")[0]).toMatchObject({ pipeline_state: "uploading" });
    expect(version).toMatchObject({ content_hash: "b".repeat(64), size_bytes: 1234 });
    expect(db.storageCalls.map((c) => c.op)).toEqual(["createSignedUploadUrl"]);
    expect(db.rows("document_events")).toMatchObject([{ detail: "Version 1 · via Order care" }]);
  });

  it("reads the size from an object with units too", async () => {
    const db = await world();
    await create({
      attachment: {
        mimeType: "application/pdf",
        contentHash: "b".repeat(64),
        size: { amount: 12.4 },
      },
    });
    expect(db.rows("document_versions")[0]).toMatchObject({ size_bytes: 12 });
  });
});

describe("registering a document from a url", () => {
  const FILE = "https://files.example.com/contract.pdf";
  /** Answers the DNS lookup of the host and then the file itself. */
  function web(file: () => Response) {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(url);
        if (new URL(url).searchParams.has("name")) {
          const type = new URL(url).searchParams.get("type");
          return new Response(
            JSON.stringify({
              Answer: type === "A" ? [{ type: 1, data: "93.184.216.34" }] : [],
            }),
          );
        }
        return file();
      }),
    );
    return fetched;
  }

  it("fetches the file, stores it, and notes where it came from", async () => {
    const db = await world();
    const fetched = web(() => new Response(TEXT));
    const res = await create({ attachment: { mimeType: "application/pdf", url: FILE } });
    expect(res.status).toBe(201);
    expect(fetched).toContain(FILE);
    expect(db.rows("documents")[0]).toMatchObject({ pipeline_state: "ready" });
    expect(db.rows("document_versions")[0]).toMatchObject({ content_hash: await sha256Hex(TEXT) });
    expect(db.rows("document_events")).toMatchObject([
      { detail: "Version 1 (fetched from url) · via Order care" },
    ]);
  });

  it("refuses 422 attachmentUnreachable when the file cannot be fetched", async () => {
    const db = await world();
    web(() => new Response("nope", { status: 404 }));
    const res = await create({ attachment: { mimeType: "application/pdf", url: FILE } });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe("attachmentUnreachable");
    expect(db.rows("documents")).toEqual([]);
  });

  it("refuses 422 attachmentUnreachable for an address on the private network, without fetching it", async () => {
    await world();
    const fetched = web(() => new Response(TEXT));
    const res = await create({
      attachment: { mimeType: "application/pdf", url: "https://127.0.0.1/contract.pdf" },
    });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe("attachmentUnreachable");
    expect(fetched.filter((u) => u.startsWith("https://127.0.0.1"))).toEqual([]);
  });

  it("refuses 422 attachmentUnreachable when the declared length is over 25 MB", async () => {
    await world();
    web(() => new Response(TEXT, { headers: { "content-length": String(25 * 1024 * 1024 + 1) } }));
    const res = await create({ attachment: { mimeType: "application/pdf", url: FILE } });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe("attachmentUnreachable");
  });

  it("does not follow redirects", async () => {
    await world();
    const fetched = web(() => new Response(TEXT));
    await create({ attachment: { mimeType: "application/pdf", url: FILE } });
    const init = vi.mocked(fetch).mock.calls.find(([u]) => u === FILE)?.[1];
    expect(init?.redirect).toBe("error");
    expect(fetched).toContain(FILE);
  });

  it("refuses 422 attachmentUnreachable when the fetch fails, for example on a redirect", async () => {
    await world();
    web(() => {
      throw new TypeError("redirect");
    });
    const res = await create({ attachment: { mimeType: "application/pdf", url: FILE } });
    expect(res.status).toBe(422);
  });

  it("refuses 422 hashMismatch when the fetched file is not the one named", async () => {
    await world();
    web(() => new Response(TEXT));
    const res = await create({
      attachment: { mimeType: "application/pdf", url: FILE, contentHash: "a".repeat(64) },
    });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe("hashMismatch");
  });

  it("uses the inline content and does not fetch the url when both are sent", async () => {
    await world();
    const fetched = web(() => new Response("other"));
    const res = await create({
      attachment: { mimeType: "application/pdf", url: FILE, content: INLINE },
    });
    expect(res.status).toBe(201);
    expect(fetched).not.toContain(FILE);
  });
});

describe("what the document type allows", () => {
  it("refuses 400 mimeNotAccepted for a file type the type does not take", async () => {
    const db = await world({ acceptedMimeTypes: ["image/png"] });
    const res = await create();
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("mimeNotAccepted");
    expect(db.rows("documents")).toEqual([]);
  });

  it("accepts a listed file type", async () => {
    await world({ acceptedMimeTypes: ["application/pdf"] });
    expect((await create()).status).toBe(201);
  });

  it("refuses 400 tooLarge for a file over the size limit of the type", async () => {
    const db = await world({ maxSizeMb: 1 });
    const res = await create({
      attachment: {
        mimeType: "application/pdf",
        contentHash: "b".repeat(64),
        size: 1024 * 1024 + 1,
      },
    });
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("tooLarge");
    expect(db.rows("documents")).toEqual([]);
  });

  it("applies the size limit to the bytes actually sent, whatever size is declared", async () => {
    const db = await world({ maxSizeMb: 1 });
    const big = btoa("a".repeat(1024 * 1024 + 1));
    const res = await create({ attachment: attachment({ content: big, size: 10 }) });
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("tooLarge");
    expect(db.rows("documents")).toEqual([]);
  });

  it("allows a file exactly at the size limit", async () => {
    await world({ maxSizeMb: 1 });
    const res = await create({
      attachment: { mimeType: "application/pdf", contentHash: "b".repeat(64), size: 1024 * 1024 },
    });
    expect(res.status).toBe(201);
  });

  it("refuses 400 unknownDocumentType for a type this organisation does not have", async () => {
    await world();
    const res = await create({ documentType: "invoice" });
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("unknownDocumentType");
  });
});

describe("what the document is about", () => {
  it("refuses 404 relatedEntityNotFound for a record that does not exist", async () => {
    const db = await world();
    const res = await create({ relatedEntity: [{ id: "ghost", role: "contract" }] });
    expect(res.status).toBe(404);
    expect(await code(res)).toBe("relatedEntityNotFound");
    expect(db.rows("documents")).toEqual([]);
  });

  it("refuses a record that belongs to another tenant", async () => {
    await world();
    const res = await create({ relatedEntity: [{ id: "ent-other", role: "contract" }] });
    expect(res.status).toBe(404);
    expect(await code(res)).toBe("relatedEntityNotFound");
  });

  it("refuses when only some of the records exist", async () => {
    await world();
    const res = await create({
      relatedEntity: [
        { id: ENTITY, role: "contract" },
        { id: "ghost", role: "party" },
      ],
    });
    expect(res.status).toBe(404);
  });

  it("accepts the same record twice with different roles and stores both links", async () => {
    const db = await world();
    const res = await create({
      relatedEntity: [
        { id: ENTITY, role: "contract" },
        { id: ENTITY, role: "party" },
      ],
    });
    expect(res.status).toBe(201);
    expect(db.rows("document_relations")).toHaveLength(2);
  });
});

describe("what the request must contain", () => {
  it.each([
    ["no name", { name: "  " }],
    ["no related record", { relatedEntity: [] }],
    [
      "more than five related records",
      {
        relatedEntity: Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, role: "r" })),
      },
    ],
    ["no attachment", { attachment: undefined }],
    ["two attachments", { attachment: [attachment(), attachment()] }],
    [
      "an attachment without a hash, url or content",
      { attachment: { mimeType: "application/pdf" } },
    ],
    ["a bad contentHash", { attachment: attachment({ contentHash: "XYZ" }) }],
  ])("refuses 400 invalidBody for %s", async (_label, over) => {
    const db = await world();
    const res = await create(over);
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("invalidBody");
    expect(db.rows("documents")).toEqual([]);
  });

  it("refuses a connected system that may not register", async () => {
    const db = await buildWorld({ scopes: ["read"], documents: [] });
    const res = await create();
    expect(res.status).toBe(403);
    expect(db.rows("documents")).toEqual([]);
  });
});

describe("registering the same document again", () => {
  it("answers the first reply and does not create a second document", async () => {
    const db = await world();
    const first = await create();
    const again = await create();
    expect(again.status).toBe(201);
    expect(again.headers.get("Idempotent-Replay")).toBe("true");
    expect((await json(again))["id"]).toBe((await json(first))["id"]);
    expect(db.rows("documents")).toHaveLength(1);
    expect(db.storageCalls).toHaveLength(1);
  });

  it("refuses the same key with different inline content", async () => {
    await world();
    await create();
    const other = await create({ attachment: attachment({ content: btoa("something else") }) });
    expect(other.status).toBe(409);
    expect(await code(other)).toBe("idempotencyMismatch");
  });

  it("does not remember a refusal, so the same key can be retried after fixing the request", async () => {
    const db = await world();
    expect((await create({ documentType: "invoice" })).status).toBe(400);
    expect((await create()).status).toBe(201);
    expect(db.rows("documents")).toHaveLength(1);
  });
});

describe("when something fails while storing", () => {
  const attempt = async (setup: (db: Awaited<ReturnType<typeof world>>) => void, over = {}) => {
    const db = await world();
    setup(db);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await create(over);
    return { db, res };
  };
  const noContent = { attachment: { mimeType: "application/pdf", contentHash: "b".repeat(64) } };
  const nothingVisible = (db: Awaited<ReturnType<typeof world>>) => {
    expect(db.rows("documents").filter((d) => !d["deleted_at"])).toEqual([]);
    expect(db.rows("idempotency_keys")).toEqual([]);
    expect(db.rows("document_events")).toEqual([]);
  };
  it("answers 503 and stores no file when the document cannot be saved", async () => {
    const { db, res } = await attempt((d) => d.fail("documents", "insert"));
    expect(res.status).toBe(503);
    expect(await code(res)).toBe("unavailable");
    expect(db.storageCalls).toEqual([]);
    nothingVisible(db);
  });
  it("answers 503, hides the document and does not remember the key when the file cannot be stored", async () => {
    const { db, res } = await attempt((d) => d.failStorage("upload"));
    expect(res.status).toBe(503);
    nothingVisible(db);
    expect(db.rows("documents")).toHaveLength(1);
    expect(db.storageCalls.map((c) => c.op)).toEqual(["upload", "remove"]);
  });
  it.each([
    ["the version cannot be saved", (d: FakeDbLike) => d.fail("document_versions", "insert")],
    ["the links cannot be saved", (d: FakeDbLike) => d.fail("document_relations", "insert")],
  ])("answers 503 and hides the document when %s", async (_label, setup) => {
    const { db, res } = await attempt(setup);
    expect(res.status).toBe(503);
    expect(db.storageCalls.at(-1)?.op).toBe("remove");
    expect(db.rows("documents").filter((d) => !d["deleted_at"])).toEqual([]);
  });
  it("answers 503 and removes the file when the document cannot point at its version", async () => {
    // Every update fails here, so the document stays hidden only if the database accepts the cleanup.
    const { db, res } = await attempt((d) => d.fail("documents", "update"));
    expect(res.status).toBe(503);
    expect(db.storageCalls.at(-1)?.op).toBe("remove");
  });
  it("answers 503 when the upload address cannot be prepared", async () => {
    const { db, res } = await attempt((d) => d.failStorage("createSignedUploadUrl"), noContent);
    expect(res.status).toBe(503);
    expect(db.storageCalls.map((c) => c.op)).toEqual(["createSignedUploadUrl"]);
    nothingVisible(db);
  });
  it("lets the same key try again after a failure", async () => {
    const db = await world();
    db.failStorage("upload");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await create()).status).toBe(503);
    db.clearStorageFailures();
    expect((await create()).status).toBe(201);
  });
});

describe("the download link of an attachment", () => {
  const VERSION = "33333333-3333-4333-8333-333333333333";
  const link = (id = DOC_ID, att = VERSION) =>
    getAttachmentContent(call("GET", `/document/${id}/attachment/${att}/content`), id, att);
  async function stored(doc: Record<string, unknown> = {}, version: Record<string, unknown> = {}) {
    const db = await buildWorld({ documents: [docRow(doc)] });
    db.tables["document_versions"] = [
      {
        id: VERSION,
        document_id: DOC_ID,
        tenant_id: TENANT,
        storage_path: `${TENANT}/${VERSION}`,
        ...version,
      },
    ];
    return db;
  }

  it("answers a signed address valid for 60 seconds, and records the download", async () => {
    const db = await stored({ pipeline_state: "ready" });
    const res = await link();
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      url: `https://storage.example/documents/${TENANT}/${VERSION}?token=t`,
      expiresInSeconds: 60,
    });
    expect(db.storageCalls).toMatchObject([
      { bucket: "documents", op: "createSignedUrl", path: `${TENANT}/${VERSION}` },
    ]);
    expect(db.rows("document_events")).toMatchObject([
      { action: "download", document_id: DOC_ID, detail: "Download link · via Order care" },
    ]);
  });

  it.each(["scanning", "quarantined"])(
    "refuses 409 contentLocked while the document is %s",
    async (state) => {
      const db = await stored({ pipeline_state: state });
      const res = await link();
      expect(res.status).toBe(409);
      expect(await code(res)).toBe("contentLocked");
      expect(db.storageCalls).toEqual([]);
      expect(db.rows("document_events")).toEqual([]);
    },
  );

  it.each(["ready", "uploading", "failed"])(
    "gives the link while the state is %s",
    async (state) => {
      await stored({ pipeline_state: state });
      expect((await link()).status).toBe(200);
    },
  );

  it("answers 404 for a version with no stored content", async () => {
    await stored({}, { storage_path: null });
    expect((await link()).status).toBe(404);
  });

  it("answers 404 for a version that belongs to another document", async () => {
    const db = await stored();
    db.rows("document_versions")[0]!["document_id"] = "someone-else";
    expect((await link()).status).toBe(404);
  });

  it("answers 404 for a document of another tenant", async () => {
    const db = await stored({ tenant_id: OTHER_TENANT });
    expect((await link()).status).toBe(404);
    expect(db.storageCalls).toEqual([]);
  });

  it("answers 503 when the storage cannot sign", async () => {
    const db = await stored({ pipeline_state: "ready" });
    db.failStorage("createSignedUrl");
    expect((await link()).status).toBe(503);
    expect(db.rows("document_events")).toEqual([]);
  });

  it("needs the read scope", async () => {
    await buildWorld({ scopes: ["register"] });
    expect((await link()).status).toBe(403);
  });
});
