// Characterisation of the Idempotency-Key handling of the TMF gateway: a repeated change is not
// applied twice, a reused key with another body is refused, and failures are not remembered.
// Uses the legal-hold and delete operations, which are small.
import { describe, expect, it, vi } from "vitest";
import {
  buildWorld,
  call,
  CLIENT_ID,
  DOC_ID,
  docRow,
  IDEM_KEY,
  json,
  OTHER_CLIENT_ID,
  TENANT,
} from "@/test/gateway-world";
import { deleteDocument, setLegalHold } from "@/test/gateway-api";

vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const hold = (over: Parameters<typeof call>[2] = {}) =>
  setLegalHold(
    call("POST", `/document/${DOC_ID}/legalHold`, {
      body: { active: true, reason: "Audit" },
      ...over,
    }),
    DOC_ID,
  );
const del = (over: Parameters<typeof call>[2] = {}) =>
  deleteDocument(call("DELETE", `/document/${DOC_ID}`, over), DOC_ID);

describe("a change needs an Idempotency-Key", () => {
  it.each([
    ["missing", null],
    ["too short", "short"],
    ["with a character outside letters, digits, - and _", "bad key with spaces!"],
    ["longer than 128 characters", "k".repeat(129)],
  ])("answers 400 idempotencyKeyMissing when it is %s", async (_name, key) => {
    const db = await buildWorld();
    const res = await hold({ idempotencyKey: key });
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("idempotencyKeyMissing");
    expect(db.writesTo("documents")).toHaveLength(0);
  });

  it("accepts a key of 8 and of 128 characters", async () => {
    await buildWorld();
    expect((await hold({ idempotencyKey: "k".repeat(8) })).status).toBe(200);
    await buildWorld();
    expect((await hold({ idempotencyKey: "k".repeat(128) })).status).toBe(200);
  });
});

describe("the same request twice has the effect of once", () => {
  it("replays the stored answer and does not touch the document or the activity again", async () => {
    const db = await buildWorld();
    const first = await hold();
    expect(first.status).toBe(200);
    expect(first.headers.get("Idempotent-Replay")).toBeNull();
    const body = await json(first);

    const second = await hold();
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotent-Replay")).toBe("true");
    expect(await json(second)).toEqual(body);

    expect(db.writesTo("documents", "update")).toHaveLength(1);
    expect(db.writesTo("document_events", "insert")).toHaveLength(1);
  });

  it("replays a delete as 204 as well", async () => {
    const db = await buildWorld();
    expect((await del()).status).toBe(204);
    const again = await del();
    expect(again.status).toBe(204);
    expect(again.headers.get("Idempotent-Replay")).toBe("true");
    expect(db.writesTo("documents", "update")).toHaveLength(1);
  });

  it("stores the answer under the tenant, the system and the operation", async () => {
    const db = await buildWorld();
    await hold();
    expect(db.rows("idempotency_keys")).toHaveLength(1);
    expect(db.rows("idempotency_keys")[0]).toMatchObject({
      tenant_id: TENANT,
      actor: CLIENT_ID,
      key: IDEM_KEY,
      operation: `tmf.hold:${DOC_ID}`,
    });
  });
});

describe("a key is bound to its request", () => {
  it("answers 409 idempotencyMismatch when the key is reused with another body", async () => {
    const db = await buildWorld();
    await hold();
    const res = await hold({ body: { active: false, reason: "Released" } });
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("idempotencyMismatch");
    expect(db.writesTo("documents", "update")).toHaveLength(1);
  });

  it("treats the same key on another operation as a new request", async () => {
    const db = await buildWorld();
    await hold({ body: { active: false, reason: "Release" } }); // the document is not on hold
    const res = await del(); // same key, different operation
    expect(res.status).toBe(204);
    expect(res.headers.get("Idempotent-Replay")).toBeNull();
    expect(db.writesTo("documents", "update")).toHaveLength(2);
  });

  it("does not replay what another system stored under the same key", async () => {
    const db = await buildWorld();
    await hold();
    db.rows("idempotency_keys")[0]!["actor"] = OTHER_CLIENT_ID;
    const res = await hold();
    expect(res.headers.get("Idempotent-Replay")).toBeNull();
    expect(db.writesTo("documents", "update")).toHaveLength(2);
  });
});

describe("only successes are remembered", () => {
  it("does not store a 404, so the same key works once the document exists", async () => {
    const db = await buildWorld({ documents: [] });
    expect((await hold()).status).toBe(404);
    expect(db.rows("idempotency_keys")).toHaveLength(0);
    db.rows("documents").push(docRow());
    expect((await hold()).status).toBe(200);
  });

  it("does not store a refusal for a rule (legal hold blocks delete), so it can be retried after release", async () => {
    const db = await buildWorld({ documents: [docRow({ legal_hold: true })] });
    const refused = await del();
    expect(refused.status).toBe(409);
    expect(db.rows("idempotency_keys")).toHaveLength(0);
    db.rows("documents")[0]!["legal_hold"] = false;
    expect((await del()).status).toBe(204);
  });
});
