//
// Rule (four-eyes): the person who added a document cannot approve it. The single-document
// path enforces this; the bulk path must too, otherwise "approve selected" is a way around it.
import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { processBulkJobs } from "@/services/bulk-worker";

const AUTHOR = "user-author";
const REVIEWER = "user-reviewer";

function world() {
  const base = {
    tenant_id: "t1",
    status: "in_review",
    legal_hold: false,
    sensitivity: "internal",
    document_type: "contract",
    current_version_id: "v1",
    deleted_at: null,
  };
  return new FakeDb({
    bulk_jobs: [
      {
        id: "job-1",
        tenant_id: "t1",
        created_by: AUTHOR, // the person pressing "approve selected"
        actor_role: "manager",
        action: "transition",
        params: { to: "approved" },
        doc_ids: ["doc-own", "doc-theirs"],
        total: 2,
        done: 0,
        changed: 0,
        skipped: {},
        status: "queued",
        created_at: "2026-11-10T10:00:00Z",
      },
    ],
    documents: [
      { ...base, id: "doc-own", created_by: AUTHOR },
      { ...base, id: "doc-theirs", created_by: REVIEWER },
    ],
    user_roles: [{ user_id: AUTHOR, tenant_id: "t1", role: "manager" }],
    extraction_fields: [],
    document_events: [],
    event_outbox: [],
  }).onRpc("effective_specifications", []);
}

const statusOf = (db: FakeDb, id: string) =>
  db.rows("documents").find((d) => d["id"] === id)?.["status"];

describe("bulk approval keeps four-eyes", () => {
  it("approves a document someone else added (control)", async () => {
    const db = world();
    await processBulkJobs(db.asDb());
    expect(statusOf(db, "doc-theirs")).toBe("approved");
  });

  it("skips the document the same person added, and counts it as skipped", async () => {
    const db = world();
    await processBulkJobs(db.asDb());
    expect(statusOf(db, "doc-own")).toBe("in_review");
    const job = db.rows("bulk_jobs")[0];
    expect(job?.["changed"]).toBe(1);
    expect((job?.["skipped"] as Record<string, number>)["ownDocument"]).toBe(1);
  });
});
describe("bulk changes follow the share level", () => {
  it("skips a document the person reaches only through a Can view share", async () => {
    const db = world();
    db.rows("document_access_exceptions").push({
      document_id: "doc-theirs",
      user_id: AUTHOR,
      level: "view",
      expires_at: null,
    });
    await processBulkJobs(db.asDb());
    expect(statusOf(db, "doc-theirs")).toBe("in_review");
    const job = db.rows("bulk_jobs")[0];
    expect(job?.["changed"]).toBe(0);
  });
});
