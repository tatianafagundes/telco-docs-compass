// Soft delete: decided from what was read, written only if the document still looks the same.
import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { deleteIfAllowed, gatewayRefusal } from "@/services/document-delete";
import { DatabaseError } from "@/services/shared/must";

const TENANT = "t1";
const row = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  tenant_id: TENANT,
  legal_hold: false,
  hold_reason: null,
  retain_until: null,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  ...over,
});
const world = (docOver: Record<string, unknown> = {}) =>
  new FakeDb({ documents: [row(docOver)], tenants: [{ id: TENANT, parent_tenant_id: null }] });
const target = (over: Record<string, unknown> = {}) => {
  const { tenant_id: _t, deleted_at: _d, ...t } = row(over);
  return t as Parameters<typeof deleteIfAllowed>[2];
};
const deletedAt = (db: FakeDb) => db.rows("documents")[0]?.["deleted_at"];

describe("deleteIfAllowed", () => {
  it("deletes a document nothing holds back", async () => {
    const db = world();
    expect(await deleteIfAllowed(db.asDb(), TENANT, target())).toBeNull();
    expect(deletedAt(db)).toBeTruthy();
  });
  it("refuses a document on hold, naming the hold reason", async () => {
    const db = world({ legal_hold: true });
    const err = await deleteIfAllowed(
      db.asDb(),
      TENANT,
      target({ legal_hold: true, hold_reason: "Audit" }),
    );
    expect(err).toMatchObject({
      code: "doc.delete.legalHold",
      customerFacing: { detail: "Audit" },
    });
    expect(deletedAt(db)).toBeNull();
  });
  it("does not delete a document of another tenant", async () => {
    const db = world({ tenant_id: "t2" });
    const err = await deleteIfAllowed(db.asDb(), TENANT, target());
    expect(err).toMatchObject({ code: "seam.unavailable" });
    expect(deletedAt(db)).toBeNull();
  });
  describe("when the document changed after it was read", () => {
    it("stops, and says why, when a hold was placed meanwhile", async () => {
      const db = world({ legal_hold: true, hold_reason: "Late hold" });
      const err = await deleteIfAllowed(db.asDb(), TENANT, target({ legal_hold: false }));
      expect(err).toMatchObject({ code: "doc.delete.legalHold" });
      expect(deletedAt(db)).toBeNull();
    });
    it("stops when a retention date was set meanwhile", async () => {
      const db = world({ retain_until: "2999-01-01" });
      const err = await deleteIfAllowed(db.asDb(), TENANT, target({ retain_until: null }));
      expect(err).toMatchObject({ code: "doc.delete.retention" });
      expect(deletedAt(db)).toBeNull();
    });
    it("asks to try again when it changed in a way that does not block", async () => {
      const db = world({ retain_until: "2020-01-01" });
      const err = await deleteIfAllowed(db.asDb(), TENANT, target({ retain_until: null }));
      expect(err).toMatchObject({ code: "seam.unavailable", retryable: true });
      expect(deletedAt(db)).toBeNull();
    });
  });
  it("does not move the deletion date of a document that is already deleted", async () => {
    const db = world({ deleted_at: "2026-01-01T00:00:00.000Z" });
    const err = await deleteIfAllowed(db.asDb(), TENANT, target());
    expect(err).toMatchObject({ code: "seam.unavailable" });
    expect(deletedAt(db)).toBe("2026-01-01T00:00:00.000Z");
  });
  it("applies the master floor", async () => {
    const db = new FakeDb({
      documents: [row({ created_at: new Date().toISOString() })],
      tenants: [
        { id: TENANT, parent_tenant_id: "m" },
        { id: "m", hard_floors: { minRetentionDays: 30 } },
      ],
    });
    const err = await deleteIfAllowed(
      db.asDb(),
      TENANT,
      target({ created_at: new Date().toISOString() }),
    );
    expect(err).toMatchObject({ code: "doc.delete.retention" });
  });
  it("deletes nothing when the database fails", async () => {
    const db = world().fail("documents", "update");
    await expect(deleteIfAllowed(db.asDb(), TENANT, target())).rejects.toBeInstanceOf(
      DatabaseError,
    );
    expect(deletedAt(db)).toBeNull();
  });
});

describe("gatewayRefusal", () => {
  it("is 409 legalHold for a hold", () => {
    const r = gatewayRefusal({ code: "doc.delete.legalHold" } as never);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "legalHold" });
  });
  it("is 409 retention with the date for a retention block", () => {
    const r = gatewayRefusal({
      code: "doc.delete.retention",
      customerFacing: { key: "k", detail: "2030-01-01" },
    } as never);
    expect(r.body).toMatchObject({ code: "retention" });
    expect(JSON.stringify(r.body)).toContain("2030-01-01");
  });
  it("is 503 when the document was changing", () => {
    expect(gatewayRefusal({ code: "seam.unavailable" } as never).status).toBe(503);
  });
});
