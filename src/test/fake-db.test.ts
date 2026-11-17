// The fake is only useful if it behaves like the client the services expect.
// These tests pin that behaviour so a wrong fake cannot make a service test pass by accident.
import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";

const seed = () =>
  new FakeDb({
    documents: [
      { id: "a", tenant_id: "t1", name: "Alpha", status: "draft", deleted_at: null },
      { id: "b", tenant_id: "t1", name: "Beta", status: "approved", deleted_at: null },
      { id: "c", tenant_id: "t2", name: "Gamma", status: "draft", deleted_at: "2026-01-01" },
    ],
  });

describe("FakeDb reads", () => {
  it("filters with eq, in and is, and projects only the selected columns", async () => {
    const db = seed();
    const { data } = await db
      .from("documents")
      .select("id, name")
      .in("id", ["a", "b", "c"])
      .eq("tenant_id", "t1")
      .is("deleted_at", null)
      .order("name", { ascending: false });
    expect(data).toEqual([
      { id: "b", name: "Beta" },
      { id: "a", name: "Alpha" },
    ]);
  });

  it("maybeSingle returns one row or null", async () => {
    const db = seed();
    expect((await db.from("documents").select("id").eq("id", "a").maybeSingle()).data).toEqual({
      id: "a",
    });
    expect((await db.from("documents").select("id").eq("id", "zzz").maybeSingle()).data).toBeNull();
  });

  it("reads embedded join values through dotted paths", async () => {
    const db = new FakeDb({
      event_subscriptions: [
        { id: 1, integration_clients: { revoked_at: null } },
        { id: 2, integration_clients: { revoked_at: "2026-01-01" } },
      ],
    });
    const { data } = await db
      .from("event_subscriptions")
      .select("id, integration_clients!inner(revoked_at)")
      .is("integration_clients.revoked_at", null);
    expect(data).toEqual([{ id: 1, integration_clients: { revoked_at: null } }]);
  });
});

describe("FakeDb writes", () => {
  it("update changes only matching rows and is recorded", async () => {
    const db = seed();
    await db.from("documents").update({ status: "in_review" }).eq("id", "a");
    expect(db.rows("documents").find((r) => r["id"] === "a")?.["status"]).toBe("in_review");
    expect(db.rows("documents").find((r) => r["id"] === "b")?.["status"]).toBe("approved");
    expect(db.writesTo("documents", "update")).toHaveLength(1);
  });

  it("upsert with ignoreDuplicates keeps the first row", async () => {
    const db = new FakeDb({ event_deliveries: [{ event_id: 1, subscription_id: 9, attempts: 3 }] });
    await db.from("event_deliveries").upsert(
      [
        { event_id: 1, subscription_id: 9, attempts: 0 },
        { event_id: 2, subscription_id: 9, attempts: 0 },
      ],
      { onConflict: "event_id,subscription_id", ignoreDuplicates: true },
    );
    expect(db.rows("event_deliveries")).toEqual([
      { event_id: 1, subscription_id: 9, attempts: 3 },
      { event_id: 2, subscription_id: 9, attempts: 0 },
    ]);
  });

  it("delete removes matching rows", async () => {
    const db = seed();
    await db.from("documents").delete().lt("name", "B");
    expect(db.rows("documents").map((r) => r["id"])).toEqual(["b", "c"]);
  });
});

describe("FakeDb race helpers", () => {
  it("stubNextSelect serves one stale read and then goes back to the real data", async () => {
    const db = new FakeDb({ jobs: [{ id: 1, done: 5 }] });
    db.stubNextSelect("jobs", [{ id: 1, done: 0 }]);
    expect((await db.from("jobs").select("done").eq("id", 1).maybeSingle()).data).toEqual({
      done: 0,
    });
    expect((await db.from("jobs").select("done").eq("id", 1).maybeSingle()).data).toEqual({
      done: 5,
    });
  });

  it("onWrite runs once, right after the matching write", async () => {
    const db = new FakeDb({ jobs: [{ id: 1, status: "running" }] });
    db.onWrite("jobs", "update", () => {
      db.rows("jobs")[0]!["status"] = "failed";
    });
    await db.from("jobs").update({ done: 1 }).eq("id", 1);
    await db.from("jobs").update({ done: 2 }).eq("id", 1);
    expect(db.rows("jobs")[0]).toMatchObject({ status: "failed", done: 2 });
  });
});

describe("FakeDb errors and rpc", () => {
  it("returns an error object instead of throwing, like supabase-js", async () => {
    const db = seed().fail("documents", "update", "disk full");
    const res = await db.from("documents").update({ status: "x" }).eq("id", "a");
    expect(res.error).toEqual({ message: "disk full" });
    expect(db.writesTo("documents", "update")).toHaveLength(0);
  });

  it("answers rpc from a value or a function, and reports unknown rpc as an error", async () => {
    const db = seed()
      .onRpc("can_see_document", (args: Record<string, unknown>) => args["_doc"] === "a")
      .onRpc("fixed", 7);
    expect((await db.rpc("can_see_document", { _doc: "a" })).data).toBe(true);
    expect((await db.rpc("can_see_document", { _doc: "b" })).data).toBe(false);
    expect((await db.rpc("fixed")).data).toBe(7);
    expect((await db.rpc("unknown")).error?.message).toContain("no answer set");
  });
});
