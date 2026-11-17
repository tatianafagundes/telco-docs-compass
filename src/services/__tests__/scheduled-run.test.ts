import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { runScheduled } from "@/services/scheduled-run";
import { EXPIRE_BATCH } from "@/services/maintenance";

afterEach(() => vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});
const world = (docs: Record<string, unknown>[] = []) =>
  new FakeDb({
    bulk_jobs: [],
    documents: docs,
    document_events: [],
    idempotency_keys: [],
    integration_tokens: [],
    event_outbox: [],
  });
const due = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `d${String(i).padStart(4, "0")}`,
    tenant_id: i % 2 ? "t1" : "t2",
    status: "effective",
    expiry_date: "2020-01-01",
    deleted_at: null,
  }));

describe("runScheduled", () => {
  it("is ok when there is nothing to do", async () => {
    expect(await runScheduled(world().asDb())).toMatchObject({
      ok: true,
      processed: 0,
      failed: [],
    });
  });
  it("expires due documents and records one event each, in the right tenant", async () => {
    const db = world(due(4));
    const res = await runScheduled(db.asDb());
    expect(res).toMatchObject({ ok: true, expiredDocuments: 4 });
    expect(db.rows("document_events")).toHaveLength(4);
    expect(db.writesTo("document_events", "insert")).toHaveLength(1); // one batch, not one call per document
    expect(
      db
        .rows("document_events")
        .map((e) => e["tenant_id"])
        .sort(),
    ).toEqual(["t1", "t1", "t2", "t2"]);
  });
  it("expires at most one batch per call, and the rest on the next", async () => {
    const db = world(due(EXPIRE_BATCH + 20));
    expect((await runScheduled(db.asDb())).expiredDocuments).toBe(EXPIRE_BATCH);
    expect((await runScheduled(db.asDb())).expiredDocuments).toBe(20);
    expect((await runScheduled(db.asDb())).expiredDocuments).toBe(0);
  });
  it("still does the housekeeping, and reports failure, when bulk changes throw", async () => {
    quiet();
    const db = world(due(2)).fail("bulk_jobs", "select");
    const res = await runScheduled(db.asDb());
    expect(res).toMatchObject({ ok: false, bulkFailed: true, expiredDocuments: 2 });
  });
  it("reports failure when housekeeping fails, after bulk changes ran", async () => {
    quiet();
    const db = world(due(2)).fail("documents", "update");
    const res = await runScheduled(db.asDb());
    expect(res).toMatchObject({ ok: false, bulkFailed: false, failed: ["expireDocuments"] });
  });
  it("says the record is missing, with a count and no ids, when the events cannot be written", async () => {
    const log = quiet();
    const db = world(due(3)).fail("document_events", "insert");
    const res = await runScheduled(db.asDb());
    expect(res.failed).toEqual(["expireDocuments"]);
    const line =
      log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("expiryEvents")) ?? "";
    expect(line).toContain('"missingEvents":3');
    expect(line).not.toContain("d0000");
  });
});
