// A change that cannot be written to the activity log is not reported as done, and the key is not
// remembered, so the person can try again. The log records which step failed, not what the
// database said.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessDeniedLimiter, audit, runWrite } from "@/services/seam-runtime";
import { withRecordAccess } from "@/test/record-access";
import { FakeDb } from "@/test/fake-db";
import { hashBody } from "@/services/document-rules";

function world() {
  const caller = new FakeDb({
    user_roles: [{ user_id: "user-1", tenant_id: "tenant-a", role: "manager" }],
  }).onRpc("can_see_document", true);
  const admin = new FakeDb({
    documents: [{ id: "doc-1", tenant_id: "tenant-a" }],
    idempotency_keys: [],
    document_events: [],
  });
  withRecordAccess(admin, "user-1");
  return { caller, admin };
}
const run = (w: ReturnType<typeof world>) =>
  runWrite(
    { supabase: w.caller.asDb(), userId: "user-1" },
    w.admin.asDb(),
    {
      op: "delete",
      idempotencyKey: "key-00000001",
      body: { id: "doc-1" },
      scope: { kind: "doc", id: "doc-1" },
    },
    async (env) => {
      await audit(env, "delete", "doc-1", "x");
      return { ok: true, data: { id: "doc-1" } };
    },
  );
let logged: string[] = [];
beforeEach(() => {
  accessDeniedLimiter.reset();
  logged = [];
  vi.spyOn(console, "info").mockImplementation((m: string) => void logged.push(m));
});
afterEach(() => vi.restoreAllMocks());

describe("the activity log is part of the change", () => {
  it("answers ok and records the event when the log accepts it", async () => {
    const w = world();
    expect((await run(w)).ok).toBe(true);
    expect(w.admin.rows("document_events")).toHaveLength(1);
  });
  it("answers unavailable and does not remember the key when the event cannot be recorded", async () => {
    const w = world();
    w.admin.fail("document_events", "insert", "secret database detail");
    const res = await run(w);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("seam.unavailable");
    expect(w.admin.rows("idempotency_keys")).toEqual([]);
  });
  it("logs the step that failed and nothing the database said", async () => {
    const w = world();
    w.admin.fail("document_events", "insert", "secret database detail");
    await run(w);
    const line = logged.find((l) => l.includes('"status":"error"')) ?? "";
    expect(line).toContain("database error while recording an activity event");
    expect(line).not.toContain("secret database detail");
  });
});

describe("a saved answer older than 24 hours", () => {
  it("is not replayed, and is replaced by the new one", async () => {
    const w = world();
    const first = await run(w);
    expect(first.ok).toBe(true);
    w.admin.rows("idempotency_keys")[0]!["created_at"] = new Date(
      Date.now() - 25 * 3600_000,
    ).toISOString();
    await run(w);
    expect(w.admin.rows("document_events")).toHaveLength(2); // it ran again
    expect(w.admin.rows("idempotency_keys")).toHaveLength(1);
    await run(w);
    expect(w.admin.rows("document_events")).toHaveLength(2); // and now it replays
  });
});

describe("two simultaneous calls with the same key", () => {
  it("run the work once; the other is told to wait or gets the stored answer", async () => {
    const w = world();
    const [a, b] = await Promise.all([run(w), run(w)]);
    expect(w.admin.rows("document_events")).toHaveLength(1);
    const codes = [a, b].map((r) => (r.ok ? "ok" : r.error.code));
    expect(codes.filter((c) => c === "ok").length).toBeGreaterThanOrEqual(1);
    expect(codes.filter((c) => c !== "ok")).toSatisfy((rest: string[]) =>
      rest.every((c) => c === "seam.idempotency.inProgress"),
    );
  });
  it("tells the second caller to retry while the first has not answered", async () => {
    const w = world();
    w.admin.rows("idempotency_keys").push({
      tenant_id: "tenant-a",
      actor: "user-1",
      key: "key-00000001",
      operation: "document.delete",
      request_hash: await hashBody({ id: "doc-1" }),
      response: { pending: true },
      created_at: new Date().toISOString(),
    });
    const res = await run(w);
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toMatchObject({ code: "seam.idempotency.inProgress", retryable: true });
    expect(w.admin.rows("document_events")).toEqual([]);
  });
  it("free the key when the work throws", async () => {
    const w = world();
    w.admin.fail("document_events", "insert");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await run(w);
    expect(w.admin.rows("idempotency_keys")).toEqual([]);
  });
});

describe("a refused change", () => {
  it("is not remembered, so the same key can be sent again after fixing the request", async () => {
    const w = world();
    const refuse = () =>
      runWrite(
        { supabase: w.caller.asDb(), userId: "user-1" },
        w.admin.asDb(),
        { op: "x", idempotencyKey: "key-00000002", body: {}, scope: { kind: "doc", id: "doc-1" } },
        async () => ({
          ok: false,
          error: { code: "doc.edit.frozen", category: "rejected", retryable: false },
        }),
      );
    expect((await refuse()).ok).toBe(false);
    expect(w.admin.rows("idempotency_keys")).toEqual([]);
  });
});
