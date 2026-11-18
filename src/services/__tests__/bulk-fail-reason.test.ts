// When a bulk job is failed, the log says why, with ids and a reason code only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { processBulkJobs } from "@/services/bulk-worker";

afterEach(() => vi.restoreAllMocks());
function world() {
  return new FakeDb({
    bulk_jobs: [
      {
        id: "job-1",
        tenant_id: "t1",
        created_by: "u1",
        actor_role: "manager",
        action: "placeHold",
        params: { reason: "Case 42 confidential name" },
        doc_ids: ["d1"],
        total: 1,
        done: 0,
        changed: 0,
        skipped: {},
        status: "queued",
        created_at: "2026-11-10T10:00:00Z",
      },
    ],
    documents: [
      {
        id: "d1",
        tenant_id: "t1",
        status: "draft",
        legal_hold: false,
        sensitivity: "internal",
        document_type: "x",
        current_version_id: null,
        deleted_at: null,
        created_by: "o",
      },
    ],
    user_roles: [{ user_id: "u1", tenant_id: "t1", role: "manager" }],
    extraction_fields: [],
    document_events: [],
    event_outbox: [],
  }).onRpc("effective_specifications", []);
}
const logged = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .map((c) => String(c[0]))
    .filter((l) => l.includes('"bulk.fail"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("bulk.fail log", () => {
  it("names the reason when the person who started the job lost their role", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world();
    db.tables["user_roles"] = [];
    await processBulkJobs(db.asDb());
    expect(logged(spy)).toMatchObject([
      { job: "job-1", tenant: "t1", reason: "creatorLostRole", total: 1 },
    ]);
  });
  it("names the reason and the error type when a batch breaks, without what the database said", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world().fail("documents", "update", "secret database detail");
    await processBulkJobs(db.asDb());
    const [line] = logged(spy);
    expect(line).toMatchObject({ reason: "batchError", cause: "DatabaseError" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret database detail");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Case 42");
  });
  it("names the reason when the processor stopped and the lease ran out", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world();
    Object.assign(db.rows("bulk_jobs")[0]!, {
      status: "running",
      params: { leaseStartedAt: "2020-01-01T00:00:00Z" },
    });
    await processBulkJobs(db.asDb());
    expect(logged(spy)).toMatchObject([{ reason: "leaseExpired" }]);
  });
  it("names the reason when the counts do not add up", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world();
    Object.assign(db.rows("bulk_jobs")[0]!, { done: 1, changed: 0 });
    await processBulkJobs(db.asDb());
    expect(logged(spy)).toMatchObject([{ reason: "countsDoNotAdd" }]);
  });
});
