import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/test/fake-db";
import {
  deleteExpiredTokens,
  deleteStaleIdempotencyKeys,
  expireDueDocuments,
  runMaintenance,
} from "@/services/maintenance";
import { runWrite } from "@/services/seam-runtime";

const NOW = new Date("2026-11-17T10:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
afterEach(() => vi.restoreAllMocks());

const docs = () => [
  {
    id: "past-approved",
    tenant_id: "t1",
    status: "approved",
    expiry_date: "2026-11-16",
    deleted_at: null,
  },
  {
    id: "past-effective",
    tenant_id: "t2",
    status: "effective",
    expiry_date: "2026-11-01",
    deleted_at: null,
  },
  {
    id: "today",
    tenant_id: "t1",
    status: "effective",
    expiry_date: "2026-11-17",
    deleted_at: null,
  },
  {
    id: "future",
    tenant_id: "t1",
    status: "effective",
    expiry_date: "2026-12-01",
    deleted_at: null,
  },
  { id: "no-date", tenant_id: "t1", status: "effective", expiry_date: null, deleted_at: null },
  { id: "draft", tenant_id: "t1", status: "draft", expiry_date: "2026-01-01", deleted_at: null },
  {
    id: "in-bin",
    tenant_id: "t1",
    status: "effective",
    expiry_date: "2026-01-01",
    deleted_at: "2026-02-01",
  },
];
const statusOf = (db: FakeDb) =>
  Object.fromEntries(db.rows("documents").map((d) => [d["id"], d["status"]]));

describe("expireDueDocuments", () => {
  it("expires approved and effective documents whose date has passed, in every tenant", async () => {
    const db = new FakeDb({ documents: docs(), document_events: [] });
    expect(await expireDueDocuments(db.asDb(), NOW)).toBe(2);
    expect(statusOf(db)).toEqual({
      "past-approved": "expired",
      "past-effective": "expired",
      today: "effective",
      future: "effective",
      "no-date": "effective",
      draft: "draft",
      "in-bin": "effective",
    });
  });
  it("records one event per document, in the tenant of that document", async () => {
    const db = new FakeDb({ documents: docs(), document_events: [] });
    await expireDueDocuments(db.asDb(), NOW);
    expect(db.rows("document_events")).toMatchObject([
      { tenant_id: "t1", document_id: "past-approved", action: "statusChange" },
      { tenant_id: "t2", document_id: "past-effective", action: "statusChange" },
    ]);
  });
  it("leaves alone a document that moved on after it was found due", async () => {
    const db = new FakeDb({
      documents: [
        {
          id: "d1",
          tenant_id: "t1",
          status: "archived",
          expiry_date: "2026-11-01",
          deleted_at: null,
        },
      ],
      document_events: [],
    });
    db.stubNextSelect("documents", [{ id: "d1" }]);
    expect(await expireDueDocuments(db.asDb(), NOW)).toBe(0);
    expect(statusOf(db)["d1"]).toBe("archived");
    expect(db.rows("document_events")).toEqual([]);
  });
  it("does nothing the second time", async () => {
    const db = new FakeDb({ documents: docs(), document_events: [] });
    await expireDueDocuments(db.asDb(), NOW);
    expect(await expireDueDocuments(db.asDb(), NOW)).toBe(0);
    expect(db.rows("document_events")).toHaveLength(2);
  });
  it("throws when the database refuses, instead of reporting nothing to do", async () => {
    const db = new FakeDb({ documents: docs() }).fail("documents", "update");
    await expect(expireDueDocuments(db.asDb(), NOW)).rejects.toThrow("database error");
  });
});

describe("old keys and tokens", () => {
  it("removes idempotency keys older than 24 hours and keeps the rest", async () => {
    const db = new FakeDb({
      idempotency_keys: [
        { key: "old", created_at: hoursAgo(25) },
        { key: "recent", created_at: hoursAgo(23) },
      ],
    });
    await deleteStaleIdempotencyKeys(db.asDb(), NOW);
    expect(db.rows("idempotency_keys").map((r) => r["key"])).toEqual(["recent"]);
  });
  it("removes tokens past their expiry and keeps the rest", async () => {
    const db = new FakeDb({
      integration_tokens: [
        { id: "gone", expires_at: hoursAgo(1) },
        { id: "valid", expires_at: hoursAgo(-1) },
      ],
    });
    await deleteExpiredTokens(db.asDb(), NOW);
    expect(db.rows("integration_tokens").map((r) => r["id"])).toEqual(["valid"]);
  });
});

describe("runMaintenance", () => {
  it("runs every step and reports what it did", async () => {
    const db = new FakeDb({
      documents: docs(),
      document_events: [],
      idempotency_keys: [],
      integration_tokens: [],
    });
    expect(await runMaintenance(db.asDb(), NOW)).toEqual({ expiredDocuments: 2, failed: [] });
  });
  it("carries on when one step fails, and says which", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = new FakeDb({
      documents: docs(),
      document_events: [],
      idempotency_keys: [{ key: "old", created_at: hoursAgo(30) }],
      integration_tokens: [],
    }).fail("documents", "update");
    const res = await runMaintenance(db.asDb(), NOW);
    expect(res.failed).toEqual(["expireDocuments"]);
    expect(db.rows("idempotency_keys")).toEqual([]);
  });
});

describe("a person's request no longer does this housekeeping", () => {
  it("leaves old idempotency keys alone", async () => {
    const caller = new FakeDb({
      user_roles: [{ user_id: "u1", tenant_id: "t1", role: "manager" }],
    }).onRpc("can_see_document", true);
    const admin = new FakeDb({
      documents: [{ id: "d1", tenant_id: "t1" }],
      idempotency_keys: [{ key: "old", created_at: "2020-01-01T00:00:00Z" }],
    });
    await runWrite(
      { supabase: caller.asDb(), userId: "u1" },
      admin.asDb(),
      { op: "x", idempotencyKey: "key-00000001", body: {}, scope: { kind: "doc", id: "d1" } },
      async () => ({ ok: true, data: 1 }),
    );
    expect(admin.rows("idempotency_keys").map((r) => r["key"])).toContain("old");
  });
});
