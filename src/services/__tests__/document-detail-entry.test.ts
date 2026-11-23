// A required detail that was never read has no row to accept, so approval stayed blocked with no
// way forward. A reviewer can enter it; it counts as confirmed (an edited detail), and the activity
// log names the detail, never its value.
import { describe, expect, it } from "vitest";
import { DatabaseError } from "@/services/shared/must";
import { enterDetail, type EnterDetailDoc } from "@/services/document-detail-entry";
import { approveGate } from "@/services/review-rules";
import type { WriteEnv } from "@/services/seam-runtime";
import { FakeDb } from "@/test/fake-db";

const SPEC = [
  { name: "counterparty", required: true, extractable: true },
  { name: "contractNumber", required: true, extractable: true },
  { name: "notes", required: false, extractable: true },
  { name: "owner", required: true, extractable: false },
];
const DOC: EnterDetailDoc = {
  id: "d1",
  status: "in_review",
  current_version_id: "v1",
  characteristic: [{ name: "contractNumber", value: "C-1" }],
  updated_at: "2026-11-20T10:00:00Z",
};
function world(rows: Record<string, unknown>[] = []) {
  const admin = new FakeDb({
    documents: [
      {
        id: "d1",
        tenant_id: "t1",
        status: "in_review",
        characteristic: DOC.characteristic,
        updated_at: DOC.updated_at,
      },
    ],
    extraction_fields: rows,
    document_events: [],
  });
  const env = {
    admin: admin.asDb(),
    caller: admin.asDb(),
    userId: "u1",
    tenantId: "t1",
    role: "reviewer",
  } as WriteEnv;
  return { admin, env };
}

describe("enterDetail", () => {
  it("writes an edited row, adds the detail to the document, and logs the name only", async () => {
    const w = world();
    const r = await enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "Acme AB" });
    expect(r).toEqual({ ok: true, data: { name: "counterparty" } });
    expect(w.admin.rows("extraction_fields")).toMatchObject([
      {
        name: "counterparty",
        value: "Acme AB",
        status: "edited",
        version_id: "v1",
        document_id: "d1",
        tenant_id: "t1",
        reviewed_by: "u1",
      },
    ]);
    expect(w.admin.rows("documents")[0]?.["characteristic"]).toEqual([
      { name: "contractNumber", value: "C-1" },
      { name: "counterparty", value: "Acme AB" },
    ]);
    const log = JSON.stringify(w.admin.rows("document_events"));
    expect(log).toContain("Field counterparty entered");
    expect(log).not.toContain("Acme");
  });
  it("lets the approval gate through once every required detail is entered", async () => {
    const w = world();
    await enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "Acme AB" });
    // Each save reads the document again, as the server function does.
    const fresh = { ...DOC, ...(w.admin.rows("documents")[0] as Partial<EnterDetailDoc>) };
    await enterDetail(w.env, fresh, SPEC, { name: "contractNumber", value: "C-1" });
    const fields = w.admin.rows("extraction_fields") as { name: string; status: "edited" }[];
    expect(approveGate(SPEC, fields)).toEqual({ pending: 0 });
  });
  it.each([
    ["an optional detail", "notes"],
    ["a detail a reader could not have read", "owner"],
    ["a name the type does not have", "madeUp"],
  ])("refuses %s", async (_label, name) => {
    const w = world();
    const r = await enterDetail(w.env, DOC, SPEC, { name, value: "x" });
    expect(r).toMatchObject({ ok: false, error: { code: "extraction.detail.notRequired" } });
    expect(w.admin.rows("extraction_fields")).toEqual([]);
  });
  it("leaves a detail that already has a row to the list, whatever its status", async () => {
    for (const status of ["pending", "accepted", "rejected"]) {
      const w = world([
        { id: "f1", document_id: "d1", version_id: "v1", name: "counterparty", status },
      ]);
      const r = await enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "x" });
      expect(r).toMatchObject({ ok: false, error: { code: "extraction.detail.exists" } });
      expect(w.admin.rows("extraction_fields")).toHaveLength(1);
    }
  });
  it("is not confused by a row for another version or another detail", async () => {
    const w = world([
      { id: "f1", document_id: "d1", version_id: "v0", name: "counterparty", status: "accepted" },
      { id: "f2", document_id: "d1", version_id: "v1", name: "contractNumber", status: "accepted" },
    ]);
    const r = await enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "Acme AB" });
    expect(r.ok).toBe(true);
  });
  it.each(["superseded", "expired", "archived"] as const)(
    "refuses a closed document (%s)",
    async (status) => {
      const w = world();
      const r = await enterDetail(w.env, { ...DOC, status }, SPEC, {
        name: "counterparty",
        value: "x",
      });
      expect(r).toMatchObject({ ok: false, error: { code: "doc.edit.frozen" } });
    },
  );
  it.each(["approved", "effective"] as const)(
    "refuses an approved document (%s)",
    async (status) => {
      const w = world();
      const r = await enterDetail(w.env, { ...DOC, status }, SPEC, {
        name: "counterparty",
        value: "x",
      });
      expect(r).toMatchObject({ ok: false, error: { code: "doc.edit.approvedContent" } });
    },
  );
  it("refuses a document without a file version", async () => {
    const w = world();
    const r = await enterDetail(w.env, { ...DOC, current_version_id: null }, SPEC, {
      name: "counterparty",
      value: "x",
    });
    expect(r).toMatchObject({ ok: false, error: { code: "extraction.detail.noVersion" } });
  });
  it("is not reported as done when the row cannot be written, and a retry finishes it", async () => {
    const w = world();
    w.admin.fail("extraction_fields", "insert");
    await expect(
      enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "Acme AB" }),
    ).rejects.toBeInstanceOf(DatabaseError);
    expect(w.admin.rows("extraction_fields")).toEqual([]);
    expect(w.admin.rows("document_events")).toEqual([]);
    // The retry reads the document again, as the server function does.
    w.admin.clearFailures();
    const fresh = { ...DOC, ...(w.admin.rows("documents")[0] as Partial<EnterDetailDoc>) };
    const r = await enterDetail(w.env, fresh, SPEC, { name: "counterparty", value: "Acme AB" });
    expect(r.ok).toBe(true);
    expect(w.admin.rows("extraction_fields")).toHaveLength(1);
    expect(w.admin.rows("document_events")).toHaveLength(1);
  });
  it("finishes on retry when only the activity record failed, without a second row", async () => {
    const w = world();
    w.admin.fail("document_events", "insert");
    await expect(
      enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "Acme AB" }),
    ).rejects.toBeInstanceOf(DatabaseError);
    w.admin.clearFailures();
    const fresh = { ...DOC, ...(w.admin.rows("documents")[0] as Partial<EnterDetailDoc>) };
    const r = await enterDetail(w.env, fresh, SPEC, { name: "counterparty", value: "Acme AB" });
    expect(r.ok).toBe(true);
    expect(w.admin.rows("extraction_fields")).toHaveLength(1);
    expect(JSON.stringify(w.admin.rows("document_events"))).toContain("Field counterparty entered");
  });
  it("does not let someone else's entry, or another value, pass as a retry", async () => {
    const row = {
      id: "f1",
      document_id: "d1",
      version_id: "v1",
      name: "counterparty",
      status: "edited",
    };
    for (const other of [
      { ...row, reviewed_by: "someone-else", value: "Acme AB" },
      { ...row, reviewed_by: "u1", value: "Other AB" },
    ]) {
      const w = world([other]);
      const r = await enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "Acme AB" });
      expect(r).toMatchObject({ ok: false, error: { code: "extraction.detail.exists" } });
    }
  });
  it("refuses, and writes nothing, when the document changed after it was read", async () => {
    for (const changed of [{ updated_at: "2026-11-20T10:00:05Z" }, { status: "approved" }]) {
      const w = world();
      Object.assign(w.admin.rows("documents")[0] as object, changed);
      const r = await enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "Acme AB" });
      expect(r).toMatchObject({ ok: false, error: { code: "doc.changedMeanwhile" } });
      expect(w.admin.rows("extraction_fields")).toEqual([]);
    }
  });
  it("lets only one of two entries made from the same read through", async () => {
    const w = world();
    const first = await enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "Acme AB" });
    const second = await enterDetail(w.env, DOC, SPEC, { name: "contractNumber", value: "C-2" });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: { code: "doc.changedMeanwhile" } });
    expect(w.admin.rows("extraction_fields")).toHaveLength(1);
  });
  it("is not reported as done when the activity record cannot be written", async () => {
    const w = world();
    w.admin.fail("document_events", "insert");
    await expect(
      enterDetail(w.env, DOC, SPEC, { name: "counterparty", value: "x" }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});
