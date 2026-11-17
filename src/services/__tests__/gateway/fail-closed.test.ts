// When the database refuses a write or its activity record, a connected system is told 503 and the
// answer is not remembered, so it can retry with the same Idempotency-Key. It is never told "done".
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWorld, call, DOC_ID, docRow, json } from "@/test/gateway-world";
import {
  deleteDocument,
  patchDocument,
  setLegalHold,
  transitionDocument,
} from "@/test/gateway-api";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);
afterEach(() => vi.restoreAllMocks());

const ops = {
  delete: () => deleteDocument(call("DELETE", `/document/${DOC_ID}`), DOC_ID),
  hold: () =>
    setLegalHold(
      call("POST", `/document/${DOC_ID}/legalHold`, { body: { active: true, reason: "Audit" } }),
      DOC_ID,
    ),
  transition: () =>
    transitionDocument(
      call("POST", `/document/${DOC_ID}/transition`, { body: { lifecycleState: "in_review" } }),
      DOC_ID,
    ),
  patchFields: () =>
    patchDocument(call("PATCH", `/document/${DOC_ID}`, { body: { name: "New" } }), DOC_ID),
  patchStatus: () =>
    patchDocument(call("PATCH", `/document/${DOC_ID}`, { body: { status: "reviewed" } }), DOC_ID),
} as const;

describe.each(Object.entries(ops))("%s", (_name, run) => {
  it("answers 503 and does not remember the key when the activity record cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await buildWorld();
    db.fail("document_events", "insert", "secret database detail");
    const res = await run();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await json(res))).not.toContain("secret database detail");
    expect(db.rows("idempotency_keys")).toEqual([]);
  });
  it("answers 503 and does not remember the key when the document cannot be updated", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await buildWorld();
    db.fail("documents", "update");
    const res = await run();
    expect(res.status).toBe(503);
    expect(db.rows("idempotency_keys")).toEqual([]);
    expect(db.rows("document_events")).toEqual([]);
  });
});

describe("a document that changes while it is being changed", () => {
  it("is not moved from a status it no longer has: 409 transitionNotAllowed", async () => {
    const db = await buildWorld();
    // The read sees draft; by the time of the write another change moved it on.
    db.stubNextSelect("documents", [docRow({ status: "draft" })]);
    db.rows("documents")[0]!["status"] = "approved";
    const res = await ops.transition();
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("transitionNotAllowed");
    expect(db.rows("documents")[0]?.["status"]).toBe("approved");
    expect(db.rows("document_events")).toEqual([]);
  });
  it("is not deleted when a legal hold was placed after it was read", async () => {
    const db = await buildWorld();
    db.stubNextSelect("documents", [docRow({ legal_hold: false })]);
    db.rows("documents")[0]!["legal_hold"] = true;
    const res = await ops.delete();
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("legalHold");
    expect(db.rows("documents")[0]?.["deleted_at"]).toBeNull();
  });
});
