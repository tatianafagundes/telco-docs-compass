//
// Rule: a batch of a bulk job is applied once, even when two processors pick the job up at the
// same time (the inline run after "start" and the scheduled run can overlap).
// Observable effect checked here: one audit event per document and one batch event per pass.
import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { processBulkJobs } from "@/services/bulk-worker";

function world() {
  const base = {
    tenant_id: "t1",
    status: "in_review",
    legal_hold: false,
    sensitivity: "internal",
    document_type: "contract",
    current_version_id: "v1",
    deleted_at: null,
    created_by: "someone-else",
  };
  return new FakeDb({
    bulk_jobs: [
      {
        id: "job-1",
        tenant_id: "t1",
        created_by: "user-reviewer",
        actor_role: "manager",
        action: "transition",
        params: { to: "approved" },
        doc_ids: ["doc-1", "doc-2"],
        total: 2,
        done: 0,
        changed: 0,
        skipped: {},
        status: "queued",
        created_at: "2026-11-10T10:00:00Z",
      },
    ],
    documents: [
      { ...base, id: "doc-1" },
      { ...base, id: "doc-2" },
    ],
    user_roles: [{ user_id: "user-reviewer", tenant_id: "t1", role: "manager" }],
    extraction_fields: [],
    document_events: [],
    event_outbox: [],
  }).onRpc("effective_specifications", []);
}

const job = (db: FakeDb) => db.rows("bulk_jobs")[0] as Record<string, unknown>;
const approvedCount = (db: FakeDb) =>
  db.rows("documents").filter((d) => d["status"] === "approved").length;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe("a bulk batch is applied once", () => {
  it("applies every document and records one audit event each (single processor, control)", async () => {
    const db = world();
    await processBulkJobs(db.asDb());
    expect(db.rows("document_events")).toHaveLength(2);
    const job = db.rows("bulk_jobs")[0];
    expect([job?.["done"], job?.["changed"], job?.["status"]]).toEqual([2, 2, "done"]);
  });

  it("does not repeat the batch when two processors run at the same time", async () => {
    const db = world();
    await Promise.all([processBulkJobs(db.asDb()), processBulkJobs(db.asDb())]);
    expect(db.rows("document_events")).toHaveLength(2);
    expect(db.rows("event_outbox")).toHaveLength(1);
    const job = db.rows("bulk_jobs")[0];
    expect([job?.["done"], job?.["changed"], job?.["status"]]).toEqual([2, 2, "done"]);
  });
});

describe("a batch is held by one processor at a time", () => {
  it("leaves a job alone while another processor holds it", async () => {
    const db = world();
    Object.assign(job(db), {
      status: "running",
      params: { to: "approved", leaseStartedAt: minutesAgo(1) },
    });
    await processBulkJobs(db.asDb());
    expect(approvedCount(db)).toBe(0);
    expect(job(db)["status"]).toBe("running");
  });

  it("fails a job whose processor stopped mid-batch instead of finishing it with wrong counts", async () => {
    const db = world();
    Object.assign(job(db), {
      status: "running",
      done: 2,
      params: { to: "approved", leaseStartedAt: minutesAgo(60) },
    });
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("failed");
    expect(approvedCount(db)).toBe(0);
  });

  it("applies a job of several batches one batch per pass, keeping the counters right", async () => {
    const db = world();
    const many = Array.from({ length: 250 }, (_, i) => `bulk-${i}`);
    for (const id of many) db.rows("documents").push({ ...db.rows("documents")[0], id });
    Object.assign(job(db), { doc_ids: many, total: 250 });
    await processBulkJobs(db.asDb());
    expect([job(db)["done"], job(db)["changed"], job(db)["status"]]).toEqual([200, 200, "queued"]);
    await processBulkJobs(db.asDb());
    expect([job(db)["done"], job(db)["changed"], job(db)["status"]]).toEqual([250, 250, "done"]);
    expect(db.rows("document_events")).toHaveLength(250);
  });
});

describe("the person who started the job is checked when it runs, not only when it was created", () => {
  it("fails the job when that person no longer has a role in the tenant", async () => {
    const db = world();
    db.tables["user_roles"] = [];
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("failed");
    expect(approvedCount(db)).toBe(0);
  });

  it("uses the role they have now: a demoted person's changes are skipped", async () => {
    const db = world();
    db.rows("user_roles")[0]!["role"] = "viewer";
    await processBulkJobs(db.asDb());
    expect(approvedCount(db)).toBe(0);
    expect((job(db)["skipped"] as Record<string, number>)["noPermission"]).toBe(2);
  });
});

describe("a job never ends 'done' with counters that do not add up", () => {
  it("finishes an empty job as done", async () => {
    const db = world();
    Object.assign(job(db), { doc_ids: [], total: 0 });
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("done");
  });

  it("fails a job that reached its end without accounting for every document", async () => {
    const db = world();
    Object.assign(job(db), { done: 2, changed: 0, skipped: {} });
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("failed");
  });
});

describe("a late processor cannot repeat or undo what another one did", () => {
  const manyDocs = (db: FakeDb, n: number) => {
    const ids = Array.from({ length: n }, (_, i) => `bulk-${i}`);
    for (const id of ids) db.rows("documents").push({ ...db.rows("documents")[0], id });
    Object.assign(job(db), { doc_ids: ids, total: n });
  };

  it("does not take a batch that was already finished after it read the job", async () => {
    const db = world();
    manyDocs(db, 250);
    const staleCopy = { ...job(db) }; // what a slow processor read before anyone ran: done 0, queued
    await processBulkJobs(db.asDb()); // someone else finishes batch 1: done 200, back to queued
    expect(job(db)["done"]).toBe(200);
    db.stubNextSelect("bulk_jobs", [staleCopy]);
    await processBulkJobs(db.asDb());
    expect(db.rows("document_events")).toHaveLength(200); // batch 1 was not applied a second time
    // Re-running it would find everything already approved and overwrite the counters with
    // "0 changed, 200 skipped as unchanged". The totals of the first run must survive.
    expect(job(db)["done"]).toBe(200);
    expect(job(db)["changed"]).toBe(200);
    expect(job(db)["skipped"]).toEqual({});
  });

  it("does not bring a failed job back to life when its batch finishes late", async () => {
    const db = world();
    db.onWrite("documents", "update", () => {
      job(db)["status"] = "failed"; // failed by someone else while this batch is running
    });
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("failed");
  });
});

describe("errors are handled by where they happen", () => {
  it("leaves the job as it is when the error comes before the job was taken, so a healthy job is not killed", async () => {
    const db = world().fail("user_roles", "select", "connection reset");
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("queued");
    expect(approvedCount(db)).toBe(0);
  });

  it("fails the job, not finishes it, when the documents cannot be read after it was taken", async () => {
    const db = world().fail("documents", "select", "connection reset");
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("failed");
    expect(job(db)["changed"]).toBe(0);
  });

  it("fails the job when a change cannot be saved, and does not count it", async () => {
    const db = world().fail("documents", "update", "disk full");
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("failed");
    expect(job(db)["changed"]).toBe(0);
  });

  it("fails the job when the audit event of a change cannot be saved", async () => {
    const db = world().fail("document_events", "insert", "disk full");
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("failed");
  });
});

describe("jobs held by others do not block the waiting ones", () => {
  it("still runs a waiting job when five older jobs are held", async () => {
    const db = world();
    for (let i = 0; i < 5; i++) {
      db.rows("bulk_jobs").push({
        ...job(db),
        id: `held-${i}`,
        status: "running",
        created_at: "2026-11-01T00:00:00Z",
        params: { to: "approved", leaseStartedAt: minutesAgo(1) },
      });
    }
    await processBulkJobs(db.asDb());
    expect(approvedCount(db)).toBe(2);
  });

  it("fails a held job that has no lease at all (left behind by the previous version)", async () => {
    const db = world();
    Object.assign(job(db), { status: "running", done: 1, params: { to: "approved" } });
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("failed");
  });
});

describe("corrupted or boundary jobs", () => {
  it("fails a job whose document list is shorter than its total", async () => {
    const db = world();
    Object.assign(job(db), { doc_ids: ["doc-1"], total: 5, done: 1, changed: 1 });
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("failed");
  });

  it("finishes a job of exactly one full batch in one pass", async () => {
    const db = world();
    const ids = Array.from({ length: 200 }, (_, i) => `full-${i}`);
    for (const id of ids) db.rows("documents").push({ ...db.rows("documents")[0], id });
    Object.assign(job(db), { doc_ids: ids, total: 200 });
    await processBulkJobs(db.asDb());
    expect([job(db)["done"], job(db)["changed"], job(db)["status"]]).toEqual([200, 200, "done"]);
  });

  it("counts a document that disappeared as skipped, and still adds up", async () => {
    const db = world();
    db.tables["documents"] = db.rows("documents").filter((d) => d["id"] !== "doc-2");
    await processBulkJobs(db.asDb());
    expect(job(db)["status"]).toBe("done");
    expect((job(db)["skipped"] as Record<string, number>)["notFound"]).toBe(1);
  });
});
