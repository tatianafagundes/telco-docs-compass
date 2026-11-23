// A share's level is applied by the server: someone who reaches a document only through a
// "Can view" share cannot change it, whatever their role. Through a record, or as the
// organisation's administrator, the role applies as it is.
import { describe, expect, it } from "vitest";
import { FakeDb, type Row } from "@/test/fake-db";
import { runWrite, type WriteEnv } from "@/services/seam-runtime";
import type { AppRole, SeamResult } from "@/services/document-rules";
const DOC = "doc-1";
async function attempt(
  role: AppRole,
  admin: Record<string, Row[]>,
): Promise<{ seen: AppRole | null; code: string | null }> {
  const caller = new FakeDb({ user_roles: [{ user_id: "u1", tenant_id: "t-a", role }] });
  caller.onRpc("can_see_document", true);
  const db = new FakeDb({
    documents: [{ id: DOC, tenant_id: "t-a" }],
    idempotency_keys: [],
    document_events: [],
    document_relations: [],
    entity_access: [],
    document_access_exceptions: [],
    ...admin,
  });
  let seen: AppRole | null = null;
  const res = await runWrite(
    { supabase: caller.asDb(), userId: "u1" },
    db.asDb(),
    {
      op: "updateMetadata",
      idempotencyKey: "key-00000001",
      body: { id: DOC },
      scope: { kind: "doc", id: DOC },
    },
    async (env: WriteEnv): Promise<SeamResult<{ done: true }>> => {
      seen = env.role;
      return { ok: true, data: { done: true } };
    },
  );
  return { seen, code: res.ok ? null : res.error.code };
}
async function roleSeen(role: AppRole, admin: Record<string, Row[]>): Promise<AppRole> {
  const r = await attempt(role, admin);
  expect(r.code).toBeNull();
  return r.seen as AppRole;
}
const share = (level: string, expires_at: string | null = null) => ({
  document_access_exceptions: [{ document_id: DOC, user_id: "u1", level, expires_at }],
});
describe("share level on the server", () => {
  it("should cap a contributor reached only through a Can view share at viewer", async () => {
    expect(await roleSeen("contributor", share("view"))).toBe("viewer");
    expect(await roleSeen("manager", share("view"))).toBe("viewer");
  });
  it("should cap a Can edit share at contributor, so review and approval still need the record", async () => {
    expect(await roleSeen("manager", share("edit"))).toBe("contributor");
    expect(await roleSeen("viewer", share("edit"))).toBe("viewer");
  });
  it("should ignore an expired share", async () => {
    const both = {
      document_access_exceptions: [
        { document_id: DOC, user_id: "u1", level: "edit", expires_at: "2000-01-01T00:00:00Z" },
        { document_id: DOC, user_id: "u1", level: "view", expires_at: null },
      ],
    };
    expect(await roleSeen("contributor", both)).toBe("viewer");
  });
  it("should keep the role when the person reaches the document through one of their records", async () => {
    const viaRecord = {
      ...share("view"),
      document_relations: [{ document_id: DOC, entity_id: "ord-1" }],
      entity_access: [{ entity_id: "ord-1", user_id: "u1", level: "view" }],
    };
    expect(await roleSeen("manager", viaRecord)).toBe("manager");
  });
  it("should keep the organisation administrator's role", async () => {
    expect(await roleSeen("tenant_admin", share("view"))).toBe("tenant_admin");
  });
  it("should treat a share with an unknown level as Can view, never as no cap", async () => {
    expect(await roleSeen("manager", share("owner"))).toBe("viewer");
  });
  it("should take the strongest of several live shares", async () => {
    const two = {
      document_access_exceptions: [
        { document_id: DOC, user_id: "u1", level: "view", expires_at: null },
        { document_id: DOC, user_id: "u1", level: "edit", expires_at: null },
      ],
    };
    expect(await roleSeen("manager", two)).toBe("contributor");
  });
  it("should refuse as not found when no record and no live share is left", async () => {
    // e.g. the share expired after the visibility check: fail closed, never the full role.
    const r = await attempt("manager", share("edit", "2000-01-01T00:00:00Z"));
    expect(r).toEqual({ seen: null, code: "doc.notFound" });
    expect((await attempt("manager", {})).code).toBe("doc.notFound");
  });
  it("should refuse every document change for the group administrator, even with a share", async () => {
    const r = await attempt("master_admin", share("edit"));
    expect(r).toEqual({ seen: null, code: "access.groupAdminNoDocuments" });
  });
  it("should fail closed when the shares cannot be read", async () => {
    const caller = new FakeDb({
      user_roles: [{ user_id: "u1", tenant_id: "t-a", role: "manager" }],
    });
    caller.onRpc("can_see_document", true);
    const db = new FakeDb({
      documents: [{ id: DOC, tenant_id: "t-a" }],
      idempotency_keys: [],
      document_events: [],
    }).fail("document_access_exceptions", "select");
    let ran = false;
    const res = await runWrite(
      { supabase: caller.asDb(), userId: "u1" },
      db.asDb(),
      {
        op: "updateMetadata",
        idempotencyKey: "key-00000002",
        body: { id: DOC },
        scope: { kind: "doc", id: DOC },
      },
      async () => {
        ran = true;
        return { ok: true, data: { done: true } };
      },
    );
    expect(ran).toBe(false);
    expect(res.ok).toBe(false);
  });
});
