// Spec telco-docs-compass-hardening, tasks 1.1 and 2.1 (R1.1, R1.2, R1.3).
//
// Rule: a write may only touch a document that belongs to the caller's own tenant. Being able to
// SEE a document (a read-only share from another tenant) never lets you change it, and revoked
// access must not be bypassed by replaying an earlier request.
//
// Limit of this test: `can_see_document` is SQL, so the fake only returns what we program.
// It proves the application's own checks; row-level security is covered by
// access.integration.test.ts (RUN_ACCESS_TESTS=1).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_DENIED_LOGGED_PER_MINUTE, accessDeniedLimiter } from "@/services/seam-runtime";
import { FakeDb } from "@/test/fake-db";
import { runWrite, type WriteEnv } from "@/services/seam-runtime";
import type { SeamResult } from "@/services/document-rules";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OWN_DOC = "doc-own";
const OTHER_TENANT_DOC = "doc-other-tenant";

/** `canSee: "unknown"` leaves the visibility check without an answer, as if the database were unreachable. */
function world(callerTenant: string, canSee: boolean | "unknown" = true) {
  const caller = new FakeDb({
    user_roles: [{ user_id: "user-1", tenant_id: callerTenant, role: "manager" }],
  });
  if (canSee !== "unknown") caller.onRpc("can_see_document", canSee);
  const admin = new FakeDb({
    documents: [
      { id: OWN_DOC, tenant_id: "tenant-a" },
      { id: OTHER_TENANT_DOC, tenant_id: "tenant-a" },
    ],
    idempotency_keys: [],
    document_events: [],
  });
  return { caller, admin };
}

/**
 * The single place that knows how to call the write pipeline for a document.
 * Uses the required `scope` (task 2.1); the assertions below did not change when it was introduced.
 */
async function writeTo(
  w: ReturnType<typeof world>,
  documentId: string,
  fn: (env: WriteEnv) => Promise<SeamResult<{ done: true }>>,
  key = "key-00000001",
) {
  return runWrite(
    { supabase: w.caller.asDb(), userId: "user-1" },
    w.admin.asDb(),
    {
      op: "updateMetadata",
      idempotencyKey: key,
      body: { id: documentId },
      scope: { kind: "doc", id: documentId },
    },
    fn,
  );
}

const ok = async (): Promise<SeamResult<{ done: true }>> => ({ ok: true, data: { done: true } });

describe("a write only touches documents of the caller's own tenant", () => {
  it("lets a caller from the owning tenant write (control)", async () => {
    const w = world("tenant-a");
    const fn = vi.fn(ok);
    const res = await writeTo(w, OWN_DOC, fn);
    expect(res.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("refuses a caller from another tenant who can only see the document through a share", async () => {
    const w = world("tenant-b"); // can_see_document is true: a read-only share
    const fn = vi.fn(ok);
    const res = await writeTo(w, OTHER_TENANT_DOC, fn);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("doc.notFound");
    expect(fn).not.toHaveBeenCalled();
    expect(w.admin.writesTo("documents")).toHaveLength(0);
  });
});

describe("revoked access is not bypassed by replaying an earlier request", () => {
  it("answers notFound, not the stored success, once the caller can no longer see the document", async () => {
    const w = world("tenant-a");
    const first = await writeTo(w, OWN_DOC, ok, "key-replay-01");
    expect(first.ok).toBe(true);

    w.caller.onRpc("can_see_document", false); // access revoked after the first call
    const replay = await writeTo(w, OWN_DOC, ok, "key-replay-01");
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.code).toBe("doc.notFound");
  });
});

describe("every write path goes through the shared pipeline", () => {
  // Static guard: a new server function that skips runRead/runWrite also skips the role,
  // visibility and tenant checks. `pipeline.functions.ts` is excluded on purpose: its
  // resetTestData does its own master_admin and test-tenant check (see that file).
  const files = [
    "document-write.functions.ts",
    "retention.functions.ts",
    "search.functions.ts",
    "tenant-config.functions.ts",
    "integration-clients.functions.ts",
  ];
  for (const file of files) {
    it(`${file}: every server function uses runRead or runWrite`, () => {
      const source = readFileSync(join(process.cwd(), "src/services", file), "utf8");
      const blocks = source.split(/(?=export const \w+ = createServerFn)/).slice(1);
      expect(blocks.length).toBeGreaterThan(0);
      const bypassing = blocks
        .filter((b) => !/\brun(Read|Write)\b/.test(b))
        .map((b) => /export const (\w+)/.exec(b)?.[1]);
      expect(bypassing).toEqual([]);
    });
  }
});

describe("what the caller is told", () => {
  const code = (r: SeamResult<unknown>) => (r.ok ? "ok" : r.error.code);

  it("says the service is unavailable, not 'not found', when visibility cannot be checked", async () => {
    const w = world("tenant-a", "unknown");
    const fn = vi.fn(ok);
    const res = await writeTo(w, OWN_DOC, fn);
    expect(code(res)).toBe("seam.unavailable");
    expect(fn).not.toHaveBeenCalled();
    expect(w.admin.writesTo("document_events")).toHaveLength(0); // no false "access refused" record
  });

  it("says the service is unavailable when the document cannot be looked up", async () => {
    const w = world("tenant-a");
    w.admin.fail("documents", "select", "connection reset");
    const fn = vi.fn(ok);
    expect(code(await writeTo(w, OWN_DOC, fn))).toBe("seam.unavailable");
    expect(fn).not.toHaveBeenCalled();
  });

  it("says not found for a document that does not exist, and records the refusal", async () => {
    const w = world("tenant-a");
    const fn = vi.fn(ok);
    expect(code(await writeTo(w, "doc-that-does-not-exist", fn))).toBe("doc.notFound");
    expect(fn).not.toHaveBeenCalled();
    expect(w.admin.writesTo("document_events", "insert")).toHaveLength(1);
  });

  it("rejects a caller who has no role at all", async () => {
    const w = world("tenant-a");
    w.caller.tables["user_roles"] = [];
    const fn = vi.fn(ok);
    expect(code(await writeTo(w, OWN_DOC, fn))).toBe("access.none");
    expect(fn).not.toHaveBeenCalled();
  });

  it("refuses the same key with a different request body", async () => {
    const w = world("tenant-a");
    await writeTo(w, OWN_DOC, ok, "key-reused-01");
    const res = await runWrite(
      { supabase: w.caller.asDb(), userId: "user-1" },
      w.admin.asDb(),
      {
        op: "updateMetadata",
        idempotencyKey: "key-reused-01",
        body: { id: OWN_DOC, somethingElse: true },
        scope: { kind: "doc", id: OWN_DOC },
      },
      ok,
    );
    expect(code(res)).toBe("seam.idempotency.mismatch");
  });
});

describe("refused attempts are recorded, but cannot flood the activity log", () => {
  beforeEach(() => accessDeniedLimiter.reset());
  afterEach(() => vi.useRealTimers());

  const refuse = (w: ReturnType<typeof world>, times: number) =>
    Promise.all(
      Array.from({ length: times }, (_, i) =>
        writeTo(w, OTHER_TENANT_DOC, ok, `key-denied-${String(i).padStart(4, "0")}`),
      ),
    );
  const actions = (w: ReturnType<typeof world>) =>
    w.admin.writesTo("document_events", "insert").flatMap((e) => e.rows.map((r) => r["action"]));

  it("records every refusal while the person is under the limit", async () => {
    const w = world("tenant-b");
    await refuse(w, ACCESS_DENIED_LOGGED_PER_MINUTE);
    expect(actions(w)).toEqual(Array(ACCESS_DENIED_LOGGED_PER_MINUTE).fill("accessDenied"));
  });

  it("keeps refusing past the limit, writing one summary event instead of one row per attempt", async () => {
    const w = world("tenant-b");
    const results = await refuse(w, ACCESS_DENIED_LOGGED_PER_MINUTE + 15);
    expect(results.every((r) => !r.ok)).toBe(true);
    const logged = actions(w);
    expect(logged.filter((a) => a === "accessDenied")).toHaveLength(
      ACCESS_DENIED_LOGGED_PER_MINUTE,
    );
    expect(logged.filter((a) => a === "accessDeniedSuppressed")).toHaveLength(1);
  });

  it("starts recording again once the minute has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    const w = world("tenant-b");
    await refuse(w, ACCESS_DENIED_LOGGED_PER_MINUTE + 3);
    vi.setSystemTime(new Date("2026-11-17T12:01:01Z"));
    const before = actions(w).length;
    await writeTo(w, OTHER_TENANT_DOC, ok, "key-after-window");
    expect(actions(w).length).toBe(before + 1);
    expect(actions(w).at(-1)).toBe("accessDenied");
  });
});
