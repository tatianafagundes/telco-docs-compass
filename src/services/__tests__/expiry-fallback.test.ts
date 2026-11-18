import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/test/fake-db";
import {
  EXPIRY_FALLBACK_INTERVAL_MS,
  expireOnRead,
  resetExpiryFallback,
} from "@/services/expiry-fallback";

beforeEach(() => resetExpiryFallback());
afterEach(() => vi.restoreAllMocks());
const NOW = Date.parse("2026-11-17T10:00:00Z");
const doc = (id: string, tenant: string, over: Record<string, unknown> = {}) => ({
  id,
  tenant_id: tenant,
  status: "effective",
  expiry_date: "2026-11-01",
  deleted_at: null,
  ...over,
});
const world = () =>
  new FakeDb({
    documents: [doc("a1", "t1"), doc("a2", "t1"), doc("b1", "t2")],
    document_events: [],
  });
const statuses = (db: FakeDb) =>
  Object.fromEntries(db.rows("documents").map((d) => [d["id"], d["status"]]));

describe("expireOnRead", () => {
  it("expires only the reader's own tenant", async () => {
    const db = world();
    await expireOnRead(db.asDb(), "t1", NOW);
    expect(statuses(db)).toEqual({ a1: "expired", a2: "expired", b1: "effective" });
    expect(db.rows("document_events").map((e) => e["tenant_id"])).toEqual(["t1", "t1"]);
  });
  it("runs at most once a minute per tenant", async () => {
    const db = world();
    await expireOnRead(db.asDb(), "t1", NOW);
    db.rows("documents").push(doc("a3", "t1"));
    await expireOnRead(db.asDb(), "t1", NOW + EXPIRY_FALLBACK_INTERVAL_MS - 1);
    expect(statuses(db)["a3"]).toBe("effective");
    await expireOnRead(db.asDb(), "t1", NOW + EXPIRY_FALLBACK_INTERVAL_MS);
    expect(statuses(db)["a3"]).toBe("expired");
  });
  it("keeps each tenant's minute apart", async () => {
    const db = world();
    await expireOnRead(db.asDb(), "t1", NOW);
    await expireOnRead(db.asDb(), "t2", NOW);
    expect(statuses(db)["b1"]).toBe("expired");
  });
  it("never fails the read: a database error is logged and swallowed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world().fail("documents", "select", "secret database detail");
    await expect(expireOnRead(db.asDb(), "t1", NOW)).resolves.toBeUndefined();
    expect(String(log.mock.calls[0]?.[0])).toContain('"op":"expiry.onRead"');
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret database detail");
  });
  it("never fails the read when the privileged client cannot even be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = async () => {
      throw new Error("Missing environment variable");
    };
    await expect(expireOnRead(load as never, "t1", NOW)).resolves.toBeUndefined();
  });
  it("leaves documents that are not due or not in an expirable state", async () => {
    const db = new FakeDb({
      documents: [
        doc("today", "t1", { expiry_date: "2026-11-17" }),
        doc("draft", "t1", { status: "draft" }),
        doc("bin", "t1", { deleted_at: "2026-11-02" }),
        doc("none", "t1", { expiry_date: null }),
      ],
      document_events: [],
    });
    await expireOnRead(db.asDb(), "t1", NOW);
    expect(new Set(Object.values(statuses(db)))).toEqual(new Set(["effective", "draft"]));
  });
});
