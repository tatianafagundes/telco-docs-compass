// Characterisation of what a connected system reads: the list of documents (paging, filters,
// field selection), one document in the TMF shape, and the document specifications.
import { describe, expect, it, vi } from "vitest";
import {
  BASE,
  buildWorld,
  call,
  DOC_ID,
  docRow,
  json,
  OTHER_TENANT,
  TENANT,
} from "@/test/gateway-world";
import {
  getDocument,
  getSpecification,
  listDocuments,
  listSpecifications,
} from "@/test/gateway-api";
import { DEFAULT_LIMIT, MAX_LIMIT } from "@/services/tmf667-mapper";

vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const list = (query = "") => listDocuments(call("GET", `/document${query}`));
const ids = async (res: Response) => ((await res.json()) as { id: string }[]).map((d) => d.id);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** `n` documents, document 1 the oldest, so the newest has the highest number. */
const many = (n: number, over: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, k) =>
    docRow({
      id: uuid(k + 1),
      name: `Doc ${k + 1}`,
      updated_at: new Date(Date.UTC(2026, 0, 1, 0, k)).toISOString(),
      ...over(k + 1),
    }),
  );

describe("the list of documents", () => {
  it("shows this tenant's documents, newest change first, and counts them in the headers", async () => {
    await buildWorld({ documents: many(3) });
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Total-Count")).toBe("3");
    expect(res.headers.get("X-Result-Count")).toBe("3");
    expect(await ids(res)).toEqual([uuid(3), uuid(2), uuid(1)]);
  });

  it("leaves out deleted documents, permanently deleted ones and other tenants'", async () => {
    await buildWorld({
      documents: [
        docRow({ id: uuid(1) }),
        docRow({ id: uuid(2), deleted_at: "2026-11-02T00:00:00Z" }),
        docRow({ id: uuid(3), purged_at: "2026-11-02T00:00:00Z" }),
        docRow({ id: uuid(4), tenant_id: OTHER_TENANT }),
      ],
    });
    const res = await list();
    expect(await ids(res)).toEqual([uuid(1)]);
    expect(res.headers.get("X-Total-Count")).toBe("1");
  });

  it("answers an empty list, not an error, when there is nothing", async () => {
    await buildWorld({ documents: [] });
    const res = await list();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(res.headers.get("X-Total-Count")).toBe("0");
  });
});

describe("paging", () => {
  it("returns a default page and reports the full total", async () => {
    await buildWorld({ documents: many(DEFAULT_LIMIT + 5) });
    const res = await list();
    expect((await ids(res)).length).toBe(DEFAULT_LIMIT);
    expect(res.headers.get("X-Total-Count")).toBe(String(DEFAULT_LIMIT + 5));
    expect(res.headers.get("X-Result-Count")).toBe(String(DEFAULT_LIMIT));
  });

  it("honours offset and limit", async () => {
    await buildWorld({ documents: many(10) });
    const res = await list("?offset=2&limit=3");
    expect(await ids(res)).toEqual([uuid(8), uuid(7), uuid(6)]);
    expect(res.headers.get("X-Total-Count")).toBe("10");
  });

  it("answers an empty page past the end", async () => {
    await buildWorld({ documents: many(3) });
    const res = await list("?offset=50");
    expect(await res.json()).toEqual([]);
    expect(res.headers.get("X-Total-Count")).toBe("3");
  });

  it("never returns more than the maximum page, whatever limit is asked for", async () => {
    await buildWorld({ documents: many(MAX_LIMIT + 5) });
    expect((await ids(await list("?limit=100000"))).length).toBe(MAX_LIMIT);
  });

  it.each(["?offset=-1", "?limit=0", "?limit=abc", "?offset=1.5", "?limit="])(
    "answers 400 invalidQuery for %s",
    async (query) => {
      await buildWorld();
      const res = await list(query);
      expect(res.status).toBe(400);
      expect((await json(res))["code"]).toBe("invalidQuery");
    },
  );
});

describe("filters", () => {
  it("by document type", async () => {
    await buildWorld({
      documents: many(4, (i) => ({ document_type: i % 2 ? "contract" : "quote" })),
    });
    expect((await ids(await list("?documentType=quote"))).sort()).toEqual([uuid(2), uuid(4)]);
  });

  it("by lifecycle state, one or several", async () => {
    await buildWorld({
      documents: many(4, (i) => ({
        status: ["draft", "in_review", "approved", "effective"][i - 1],
      })),
    });
    expect(await ids(await list("?lifecycleState=draft"))).toEqual([uuid(1)]);
    expect((await ids(await list("?lifecycleState=draft,approved"))).sort()).toEqual([
      uuid(1),
      uuid(3),
    ]);
  });

  it("by the standard status, which can cover several of our states", async () => {
    await buildWorld({
      documents: many(4, (i) => ({
        status: ["effective", "superseded", "expired", "draft"][i - 1],
      })),
    });
    expect(await ids(await list("?status=published"))).toEqual([uuid(1)]);
    expect((await ids(await list("?status=archived"))).sort()).toEqual([uuid(2), uuid(3)]);
  });

  it("combines status and lifecycleState by intersection", async () => {
    await buildWorld({
      documents: many(3, (i) => ({ status: ["superseded", "expired", "effective"][i - 1] })),
    });
    expect(await ids(await list("?status=archived&lifecycleState=expired"))).toEqual([uuid(2)]);
    expect(await ids(await list("?status=archived&lifecycleState=effective"))).toEqual([]);
  });

  it("by an external identifier", async () => {
    await buildWorld({
      documents: many(3, (i) => ({
        external_identifier: i === 2 ? [{ id: "ORD-7", owner: "Order care" }] : [],
      })),
    });
    expect(await ids(await list("?externalIdentifier.id=ORD-7"))).toEqual([uuid(2)]);
  });

  it("by the record the document belongs to, only counting records of this tenant", async () => {
    const db = await buildWorld({ documents: many(3) });
    db.tables["document_relations"] = [
      {
        document_id: uuid(1),
        entity_id: "ent-1",
        role: "contract",
        business_entities: { id: "ent-1", referred_type: "Agreement", tenant_id: TENANT },
      },
      {
        document_id: uuid(2),
        entity_id: "ent-2",
        role: "contract",
        business_entities: { id: "ent-2", referred_type: "Quote", tenant_id: TENANT },
      },
      {
        document_id: uuid(3),
        entity_id: "ent-1",
        role: "contract",
        business_entities: { id: "ent-1", referred_type: "Agreement", tenant_id: OTHER_TENANT },
      },
    ];
    expect(await ids(await list("?relatedEntity.id=ent-1"))).toEqual([uuid(1)]);
    expect(await ids(await list("?relatedEntity.@referredType=Quote"))).toEqual([uuid(2)]);
    const none = await list("?relatedEntity.id=nobody");
    expect(await none.json()).toEqual([]);
    expect(none.headers.get("X-Total-Count")).toBe("0");
  });

  it.each(["?lifecycleState=bogus", "?status=bogus", "?lifecycleState=draft,bogus"])(
    "answers 400 invalidQuery for %s",
    async (query) => {
      await buildWorld();
      const res = await list(query);
      expect(res.status).toBe(400);
      expect((await json(res))["code"]).toBe("invalidQuery");
    },
  );
});

describe("choosing the fields", () => {
  it("keeps only the fields asked for, plus id, href and type", async () => {
    await buildWorld();
    const [doc] = (await (await list("?fields=name,status")).json()) as Record<string, unknown>[];
    expect(Object.keys(doc ?? {}).sort()).toEqual(["@type", "href", "id", "name", "status"]);
  });

  it("ignores a field that does not exist", async () => {
    await buildWorld();
    const [doc] = (await (await list("?fields=nonsense")).json()) as Record<string, unknown>[];
    expect(Object.keys(doc ?? {}).sort()).toEqual(["@type", "href", "id"]);
  });
});

describe("one document", () => {
  const read = (query = "") => getDocument(call("GET", `/document/${DOC_ID}${query}`), DOC_ID);

  it("is shown in the TMF shape, with its links, status and attachments", async () => {
    const db = await buildWorld({
      documents: [
        docRow({
          status: "effective",
          external_identifier: [
            { id: "ORD-1", owner: "Order care", externalIdentifierType: "order" },
          ],
        }),
      ],
    });
    db.rows("document_versions").push({
      id: "ver-1",
      document_id: DOC_ID,
      tenant_id: TENANT,
      label: "v1",
      mime_type: "application/pdf",
      size_bytes: 10,
      content_hash: "h",
      created_at: "2026-11-01T10:00:00Z",
    });
    const doc = await json(await read());
    expect(doc).toMatchObject({
      id: DOC_ID,
      href: `${BASE}/document/${DOC_ID}`,
      "@type": "EradDocument",
      "@baseType": "Document",
      name: "Master agreement",
      documentType: "contract",
      status: "published", // our "effective"
      creationDate: "2026-11-01T10:00:00Z",
      relatedParty: [{ id: TENANT, role: "owner" }],
      externalIdentifier: [{ id: "ORD-1", owner: "Order care", externalIdentifierType: "order" }],
    });
    expect(doc["documentSpecification"]).toMatchObject({ id: "contract" });
    expect(doc["attachment"]).toMatchObject([
      { id: "ver-1", href: `${BASE}/document/${DOC_ID}/attachment/ver-1` },
    ]);
  });

  it.each([
    ["draft", "created"],
    ["in_review", "reviewed"],
    ["approved", "approved"],
    ["effective", "published"],
    ["superseded", "archived"],
    ["expired", "archived"],
    ["archived", "archived"],
  ])("shows our %s status as %s", async (status, shown) => {
    await buildWorld({ documents: [docRow({ status })] });
    expect((await json(await read()))["status"]).toBe(shown);
  });

  it("can be cut down to the fields asked for", async () => {
    await buildWorld();
    const doc = await json(await read("?fields=name"));
    expect(Object.keys(doc).sort()).toEqual(["@type", "href", "id", "name"]);
  });
  it.each([
    ["another tenant's", { tenant_id: OTHER_TENANT }],
    ["a deleted", { deleted_at: "2026-11-02T00:00:00Z" }],
    ["a permanently deleted", { purged_at: "2026-11-02T00:00:00Z" }],
  ])("answers 404 for %s document", async (_label, over) => {
    await buildWorld({ documents: [docRow(over)] });
    expect((await read()).status).toBe(404);
  });
});

describe("document specifications", () => {
  const spec = {
    code: "contract",
    name: "Contract",
    definition: {
      category: "Legal",
      specCharacteristic: [{ name: "counterparty", required: true }],
    },
  };

  it("lists the types this tenant can use, asking only for its own tenant", async () => {
    const db = await buildWorld({ specs: [spec] });
    const asked: unknown[] = [];
    db.onRpc("effective_specifications", (args: Record<string, unknown>) => {
      asked.push(args);
      return [spec];
    });
    const res = await listSpecifications(call("GET", "/documentSpecification"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject([
      {
        id: "contract",
        name: "Contract",
        "@type": "DocumentSpecification",
        specCharacteristic: [{ name: "counterparty", required: true }],
      },
    ]);
    expect(asked).toEqual([{ p_tenant: TENANT }]);
  });

  it("shows one type by its code, and answers 404 for one that does not exist", async () => {
    await buildWorld({ specs: [spec] });
    const found = await getSpecification(
      call("GET", "/documentSpecification/contract"),
      "contract",
    );
    expect(found.status).toBe(200);
    expect((await json(found))["id"]).toBe("contract");
    const missing = await getSpecification(call("GET", "/documentSpecification/nope"), "nope");
    expect(missing.status).toBe(404);
    expect((await json(missing))["code"]).toBe("notFound");
  });
});
