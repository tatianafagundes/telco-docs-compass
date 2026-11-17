// Characterisation of delete and legal hold through the TMF gateway.
import { describe, expect, it, vi } from "vitest";
import { buildWorld, call, DOC_ID, docRow, json } from "@/test/gateway-world";
import { deleteDocument, setLegalHold } from "@/test/gateway-api";

vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const del = () => deleteDocument(call("DELETE", `/document/${DOC_ID}`), DOC_ID);
const hold = (body: unknown) =>
  setLegalHold(call("POST", `/document/${DOC_ID}/legalHold`, { body }), DOC_ID);
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe("delete", () => {
  it("removes the document from view and records it in the activity, naming the system", async () => {
    const db = await buildWorld();
    const res = await del();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(db.rows("documents")[0]?.["deleted_at"]).toBeTruthy();
    const event = db.writesTo("document_events", "insert")[0]?.rows[0];
    expect(event).toMatchObject({ action: "delete", document_id: DOC_ID, actor: null });
    expect(String(event?.["detail"])).toContain("Order care");
  });

  it("answers 404 for a document that does not exist or is already deleted", async () => {
    await buildWorld({ documents: [docRow({ deleted_at: "2026-11-02T00:00:00Z" })] });
    expect((await del()).status).toBe(404);
  });

  it("is refused with 409 legalHold while a legal hold is on", async () => {
    const db = await buildWorld({ documents: [docRow({ legal_hold: true })] });
    const res = await del();
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("legalHold");
    expect(db.rows("documents")[0]?.["deleted_at"]).toBeNull();
  });

  describe("the retention date", () => {
    it("refuses with 409 retention while the document must be kept", async () => {
      const db = await buildWorld({ documents: [docRow({ retain_until: day(1) })] });
      const res = await del();
      expect(res.status).toBe(409);
      expect((await json(res))["code"]).toBe("retention");
      expect(db.rows("documents")[0]?.["deleted_at"]).toBeNull();
    });

    it("allows it after the date", async () => {
      await buildWorld({ documents: [docRow({ retain_until: day(-1) })] });
      expect((await del()).status).toBe(204);
    });

    // Characterises today's behaviour on the boundary day.
    it("allows it on the date itself", async () => {
      await buildWorld({ documents: [docRow({ retain_until: day(0) })] });
      expect((await del()).status).toBe(204);
    });
  });
});

describe("legal hold", () => {
  it("places a hold and keeps the reason, the reference and when it started", async () => {
    const db = await buildWorld();
    const res = await hold({ active: true, reason: "Audit 2026", reference: "CASE-7" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: DOC_ID, legalHold: true });
    expect(db.rows("documents")[0]).toMatchObject({
      legal_hold: true,
      hold_reason: "Audit 2026",
      hold_reference: "CASE-7",
      hold_set_by: null,
    });
    expect(db.rows("documents")[0]?.["hold_since"]).toBeTruthy();
    const event = db.writesTo("document_events", "insert")[0]?.rows[0];
    expect(event).toMatchObject({ action: "hold" });
    expect(String(event?.["detail"])).toContain("CASE-7");
  });

  it("releases a hold and clears what it stored", async () => {
    const db = await buildWorld({
      documents: [docRow({ legal_hold: true, hold_reason: "Audit", hold_since: "2026-11-01" })],
    });
    const res = await hold({ active: false, reason: "Case closed" });
    expect(res.status).toBe(200);
    expect(db.rows("documents")[0]).toMatchObject({
      legal_hold: false,
      hold_reason: null,
      hold_reference: null,
      hold_since: null,
    });
  });

  it.each([
    ["no reason", { active: true }],
    ["an empty reason", { active: true, reason: "   " }],
    ["a reason that is too long", { active: true, reason: "x".repeat(501) }],
    ["active that is not true or false", { active: "yes", reason: "Audit" }],
    ["no body at all", {}],
  ])("answers 400 invalidBody for %s", async (_name, body) => {
    const db = await buildWorld();
    const res = await hold(body);
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("invalidBody");
    expect(db.writesTo("documents")).toHaveLength(0);
  });

  it("answers 400 invalidJson when the body is not JSON", async () => {
    await buildWorld();
    const req = new Request(
      "https://app.example/api/public/tmf-api/document/v4/document/x/legalHold",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${"erad_" + "k".repeat(24)}`,
          "idempotency-key": "idem-key-0001",
          "content-type": "application/json",
        },
        body: "{not json",
      },
    );
    const res = await setLegalHold(req, DOC_ID);
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("invalidJson");
  });

  it("answers 400 bodyTooLarge for a body over the limit", async () => {
    await buildWorld();
    const res = await hold({ active: true, reason: "x", pad: "y".repeat(60_000) });
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("bodyTooLarge");
  });
});
