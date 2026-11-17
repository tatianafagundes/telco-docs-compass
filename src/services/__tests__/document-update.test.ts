import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { holdColumns, updateDocument } from "@/services/document-update";
import { DatabaseError } from "@/services/shared/must";

const NOW = "2026-11-17T10:00:00.000Z";
describe("holdColumns", () => {
  it("sets everything when a hold is placed", () => {
    expect(
      holdColumns({ active: true, reason: "Audit", reference: "CASE-1" }, "user-1", NOW),
    ).toEqual({
      legal_hold: true,
      hold_reason: "Audit",
      hold_reference: "CASE-1",
      hold_since: NOW,
      hold_set_by: "user-1",
      updated_at: NOW,
    });
  });
  it("clears everything when it is released, even if a reason is sent", () => {
    expect(holdColumns({ active: false, reason: "Closed" }, "user-1", NOW)).toEqual({
      legal_hold: false,
      hold_reason: null,
      hold_reference: null,
      hold_since: null,
      hold_set_by: null,
      updated_at: NOW,
    });
  });
  it("keeps a missing reason or reference as null, and a system as no person", () => {
    expect(holdColumns({ active: true }, null, NOW)).toMatchObject({
      hold_reason: null,
      hold_reference: null,
      hold_set_by: null,
    });
  });
});
describe("updateDocument", () => {
  it("changes only the document asked for", async () => {
    const db = new FakeDb({
      documents: [
        { id: "a", status: "draft" },
        { id: "b", status: "draft" },
      ],
    });
    await updateDocument(db.asDb(), "a", { status: "approved" }, "testing");
    expect(db.rows("documents").map((d) => d["status"])).toEqual(["approved", "draft"]);
  });
  it("throws naming the step when the database refuses", async () => {
    const db = new FakeDb({ documents: [{ id: "a" }] }).fail("documents", "update", "boom");
    const err = await updateDocument(db.asDb(), "a", {}, "testing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseError);
    expect((err as Error).message).toBe("database error while testing");
  });
});
