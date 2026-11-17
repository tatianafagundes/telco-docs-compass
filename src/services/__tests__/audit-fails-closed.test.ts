// A change that cannot be written to the activity log is not reported as done, and the key is not
// remembered, so the person can try again. The log records which step failed, not what the
// database said.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessDeniedLimiter, audit, runWrite } from "@/services/seam-runtime";
import { FakeDb } from "@/test/fake-db";

function world() {
  const caller = new FakeDb({
    user_roles: [{ user_id: "user-1", tenant_id: "tenant-a", role: "manager" }],
  }).onRpc("can_see_document", true);
  const admin = new FakeDb({
    documents: [{ id: "doc-1", tenant_id: "tenant-a" }],
    idempotency_keys: [],
    document_events: [],
  });
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
