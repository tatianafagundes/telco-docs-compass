// Spec telco-docs-compass-hardening, tasks 1.x and 2.4 (R3.4).
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
    extraction_fields: [],
    document_events: [],
    event_outbox: [],
  }).onRpc("effective_specifications", []);
}

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
