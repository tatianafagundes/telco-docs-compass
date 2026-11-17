// Characterisation of PATCH /document/{id}: what a connected system may change, what is locked
// once a document is approved, which scope each kind of change needs, and what is recorded.
import { describe, expect, it, vi } from "vitest";
import {
  ALL_SCOPES,
  buildWorld,
  call,
  DOC_ID,
  docRow,
  json,
  OTHER_DOC_ID,
  OTHER_TENANT,
  TENANT,
} from "@/test/gateway-world";
import { patchDocument } from "@/test/gateway-api";

vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const patch = (body: unknown, over: Parameters<typeof call>[2] = {}, id = DOC_ID) =>
  patchDocument(
    call("PATCH", `/document/${id}`, {
      body,
      headers: { "content-type": "application/merge-patch+json" },
      ...over,
    }),
    id,
  );
const without = (...scopes: string[]) => ALL_SCOPES.filter((s) => !scopes.includes(s));

describe("what the request must look like", () => {
  it.each(["application/merge-patch+json", "application/json", "application/json; charset=utf-8"])(
    "accepts %s",
    async (type) => {
      await buildWorld();
      expect((await patch({ name: "New" }, { headers: { "content-type": type } })).status).toBe(
        200,
      );
    },
  );

  it("answers 415 for another content type", async () => {
    const db = await buildWorld();
    const res = await patch({ name: "New" }, { headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(415);
    expect((await json(res))["code"]).toBe("unsupportedMediaType");
    expect(db.writesTo("documents")).toHaveLength(0);
  });

  it.each([
    ["a field that cannot be changed", { document_type: "quote" }],
    ["an empty name", { name: "   " }],
    ["a name longer than 255 characters", { name: "n".repeat(256) }],
    ["a description longer than 2,000 characters", { description: "d".repeat(2001) }],
    [
      "more than 50 characteristics",
      { characteristic: Array.from({ length: 51 }, (_, i) => ({ name: `c${i}`, value: "v" })) },
    ],
    ["a date that is not in the YYYY-MM-DD form", { validFor: { endDateTime: "next year" } }],
    ["a date that does not exist", { validFor: { endDateTime: "2024-99-99T00:00:00Z" } }],
    ["a day that does not exist", { validFor: { endDateTime: "2027-02-30" } }],
  ])("answers 400 invalidBody for %s", async (_name, body) => {
    const db = await buildWorld();
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("invalidBody");
    expect(db.writesTo("documents")).toHaveLength(0);
  });

  it("answers 400 invalidStatus for a status that is not one we know", async () => {
    await buildWorld();
    const res = await patch({ status: "deleted" });
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("invalidStatus");
  });

  it("answers 400 invalidJson for a body that is not JSON", async () => {
    await buildWorld();
    const req = new Request("https://app.example/x", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${"erad_" + "k".repeat(24)}`,
        "content-type": "application/merge-patch+json",
        "idempotency-key": "idem-key-0001",
      },
      body: "{oops",
    });
    const res = await patchDocument(req, DOC_ID);
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("invalidJson");
  });
});

describe("which scope a change needs", () => {
  it("a status-only change needs the transition scope, not the register scope", async () => {
    await buildWorld({ scopes: ["transition"] });
    expect((await patch({ status: "reviewed" })).status).toBe(200);
  });

  it("approving by status needs the approve scope", async () => {
    await buildWorld({
      scopes: without("approve"),
      documents: [docRow({ status: "in_review" })],
    });
    const res = await patch({ status: "approved" });
    expect(res.status).toBe(403);
    expect(String((await json(res))["message"])).toContain("approve");
  });

  it("changing other fields needs the register scope", async () => {
    await buildWorld({ scopes: ["transition"] });
    const res = await patch({ name: "New" });
    expect(res.status).toBe(403);
    expect(String((await json(res))["message"])).toContain("register");
  });

  it("changing fields together with the status needs both scopes", async () => {
    await buildWorld({ scopes: without("transition") });
    const res = await patch({ name: "New", status: "reviewed" });
    expect(res.status).toBe(403);
    expect(String((await json(res))["message"])).toContain("transition");
  });
});

describe("changing the details of a document", () => {
  it("changes the name and description, and records only the names of the fields", async () => {
    const db = await buildWorld();
    const res = await patch({ name: "Renamed agreement", description: "Signed in Stockholm" });
    expect(res.status).toBe(200);
    expect(db.rows("documents")[0]).toMatchObject({
      name: "Renamed agreement",
      description: "Signed in Stockholm",
    });
    const event = db.writesTo("document_events", "insert")[0]?.rows[0];
    expect(event).toMatchObject({ action: "metadataChange", document_id: DOC_ID });
    expect(String(event?.["detail"])).toContain("Changed name, description");
    expect(JSON.stringify(event)).not.toContain("Renamed agreement");
    expect(JSON.stringify(event)).not.toContain("Stockholm");
  });

  it("stores the end date as a day", async () => {
    const db = await buildWorld();
    expect((await patch({ validFor: { endDateTime: "2027-03-01T00:00:00Z" } })).status).toBe(200);
    expect(db.rows("documents")[0]?.["expiry_date"]).toBe("2027-03-01");
  });

  it("merges characteristics by name and keeps the ones it was not given", async () => {
    const db = await buildWorld({
      documents: [
        docRow({
          characteristic: [
            { name: "counterparty", value: "Old AB" },
            { name: "term", value: "12" },
          ],
        }),
      ],
    });
    await patch({ characteristic: [{ name: "counterparty", value: "New AB" }] });
    expect(db.rows("documents")[0]?.["characteristic"]).toEqual([
      { name: "term", value: "12" },
      { name: "counterparty", value: "New AB" },
    ]);
  });

  it("replaces the external identifiers", async () => {
    const db = await buildWorld();
    await patch({
      externalIdentifier: [{ id: "ORD-1", owner: "Order care", externalIdentifierType: "order" }],
    });
    expect(db.rows("documents")[0]?.["external_identifier"]).toEqual([
      { id: "ORD-1", owner: "Order care", externalIdentifierType: "order" },
    ]);
  });

  it("does nothing, and records nothing, when the body has no change", async () => {
    const db = await buildWorld();
    const res = await patch({});
    expect(res.status).toBe(200);
    expect(db.writesTo("documents")).toHaveLength(0);
    expect(db.writesTo("document_events")).toHaveLength(0);
  });
});

describe("linking the document to records", () => {
  const relate = [{ id: "ent-1", role: "contract", "@referredType": "Agreement" }];

  it("adds a link to a record of this tenant", async () => {
    const db = await buildWorld();
    db.tables["business_entities"] = [{ id: "ent-1", tenant_id: TENANT }];
    expect((await patch({ relatedEntity: relate })).status).toBe(200);
    expect(db.rows("document_relations")).toEqual([
      { document_id: DOC_ID, entity_id: "ent-1", role: "contract" },
    ]);
  });

  it.each([
    ["a record that does not exist", []],
    ["a record of another tenant", [{ id: "ent-1", tenant_id: OTHER_TENANT }]],
  ])("answers 404 relatedEntityNotFound for %s", async (_name, entities) => {
    const db = await buildWorld();
    db.tables["business_entities"] = entities;
    const res = await patch({ relatedEntity: relate });
    expect(res.status).toBe(404);
    expect((await json(res))["code"]).toBe("relatedEntityNotFound");
    expect(db.rows("document_relations")).toHaveLength(0);
  });
});

describe("approved and frozen documents", () => {
  it.each(["approved", "effective"])(
    "a %s document still lets name, description and external identifiers change",
    async (status) => {
      const db = await buildWorld({ documents: [docRow({ status })] });
      const res = await patch({ name: "Better name", description: "Clearer" });
      expect(res.status).toBe(200);
      expect(db.rows("documents")[0]?.["name"]).toBe("Better name");
    },
  );

  it.each([
    ["characteristic", { characteristic: [{ name: "term", value: "24" }] }],
    ["validFor", { validFor: { endDateTime: "2027-03-01" } }],
  ])(
    "a approved document refuses a change to %s with 409 approvedContentLocked",
    async (field, body) => {
      const db = await buildWorld({ documents: [docRow({ status: "approved" })] });
      const res = await patch(body);
      expect(res.status).toBe(409);
      const answer = await json(res);
      expect(answer["code"]).toBe("approvedContentLocked");
      expect(String(answer["message"])).toContain(field);
      expect(db.writesTo("documents")).toHaveLength(0);
    },
  );

  it.each(["superseded", "expired", "archived"])(
    "a %s document refuses any change with 409 frozen",
    async (status) => {
      const db = await buildWorld({ documents: [docRow({ status })] });
      const res = await patch({ name: "Too late" });
      expect(res.status).toBe(409);
      expect((await json(res))["code"]).toBe("frozen");
      expect(db.writesTo("documents")).toHaveLength(0);
    },
  );
});

describe("changing the status through PATCH", () => {
  it("moves a document along the same path as the transition operation", async () => {
    const db = await buildWorld();
    const res = await patch({ status: "reviewed" });
    expect(res.status).toBe(200);
    expect(db.rows("documents")[0]?.["status"]).toBe("in_review");
  });

  it("refuses a move that is not on the path, with 409", async () => {
    const db = await buildWorld();
    const res = await patch({ status: "published" });
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("transitionNotAllowed");
    expect(db.rows("documents")[0]?.["status"]).toBe("draft");
  });

  it("applies the field changes first, so a refused move leaves them applied", async () => {
    const db = await buildWorld();
    const res = await patch({ name: "Renamed", status: "published" });
    expect(res.status).toBe(409);
    expect(db.rows("documents")[0]).toMatchObject({ name: "Renamed", status: "draft" });
  });
});

describe("whose document it is", () => {
  it("answers 404 for a document of another tenant or one that does not exist, and changes nothing", async () => {
    const db = await buildWorld();
    for (const id of [OTHER_DOC_ID, "33333333-3333-4333-8333-333333333333", "not-an-id"]) {
      const res = await patch({ name: "Hijacked" }, {}, id);
      expect(res.status, id).toBe(404);
    }
    expect(db.writesTo("documents")).toHaveLength(0);
  });

  it("is not applied twice when the same request is repeated", async () => {
    const db = await buildWorld();
    await patch({ name: "Once" });
    const again = await patch({ name: "Once" });
    expect(again.headers.get("Idempotent-Replay")).toBe("true");
    expect(db.writesTo("documents", "update")).toHaveLength(1);
  });
});
