import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { holdColumns, updateDocument, updateDocumentIf } from "@/services/document-update";
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
        { id: "a", tenant_id: "t", status: "draft" },
        { id: "b", tenant_id: "t", status: "draft" },
        { id: "a", tenant_id: "other", status: "draft" },
      ],
    });
    await updateDocument(db.asDb(), { id: "a", tenantId: "t" }, { status: "approved" }, "testing");
    expect(db.rows("documents").map((d) => d["status"])).toEqual(["approved", "draft", "draft"]); // not b, not the other tenant's a
  });
  it("throws naming the step when the database refuses", async () => {
    const db = new FakeDb({ documents: [{ id: "a" }] }).fail("documents", "update", "boom");
    const err = await updateDocument(db.asDb(), { id: "a", tenantId: "t" }, {}, "testing").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DatabaseError);
    expect((err as Error).message).toBe("database error while testing");
  });
});

describe("updateDocumentIf", () => {
  const db = () =>
    new FakeDb({ documents: [{ id: "a", tenant_id: "t", status: "draft", retain_until: null }] });
  const where = (exp: Record<string, string | boolean | null>) => ({
    id: "a",
    tenantId: "t",
    expect: exp,
  });
  it("updates when the row still matches, and says so", async () => {
    const d = db();
    expect(
      await updateDocumentIf(
        d.asDb(),
        where({ status: "draft", retain_until: null }),
        { status: "approved" },
        "x",
      ),
    ).toBe(true);
    expect(d.rows("documents")[0]?.["status"]).toBe("approved");
  });
  it.each([[{ status: "approved" }], [{ retain_until: "2030-01-01" }]])(
    "does nothing when %j no longer matches",
    async (exp) => {
      const d = db();
      expect(await updateDocumentIf(d.asDb(), where(exp), { status: "approved" }, "x")).toBe(false);
      expect(d.rows("documents")[0]?.["status"]).toBe("draft");
    },
  );
  it("does nothing for another tenant", async () => {
    const d = db();
    expect(
      await updateDocumentIf(
        d.asDb(),
        { id: "a", tenantId: "other", expect: {} },
        { status: "archived" },
        "x",
      ),
    ).toBe(false);
  });
  it("refuses an expectation with no value instead of dropping the condition", async () => {
    const d = db();
    await expect(
      updateDocumentIf(
        d.asDb(),
        where({ status: undefined as unknown as string }),
        { status: "archived" },
        "x",
      ),
    ).rejects.toThrow("no value to expect");
    expect(d.rows("documents")[0]?.["status"]).toBe("draft");
  });
});
