import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { countDeadLetters, resendDeadLetter } from "@/services/delivery-dead-letter";
import { runMaintenance } from "@/services/maintenance";
import { DatabaseError } from "@/services/shared/must";

const row = (over: Record<string, unknown>) => ({
  tenant_id: "t1",
  event_id: 1,
  subscription_id: "s1",
  attempts: 8,
  gave_up_at: "2026-11-01T00:00:00Z",
  next_attempt_at: "2026-11-01T00:00:00Z",
  locked_until: "2026-11-01T00:05:00Z",
  last_error: "HTTP 500",
  last_status: 500,
  delivered_at: null,
  ...over,
});
const world = () =>
  new FakeDb({
    event_deliveries: [
      row({}),
      row({ event_id: 2, tenant_id: "t2" }),
      row({ event_id: 3, gave_up_at: null, attempts: 2 }),
      row({ event_id: 4, gave_up_at: null, delivered_at: "2026-11-02T00:00:00Z" }),
    ],
  });

describe("countDeadLetters", () => {
  it("counts only the deliveries that were given up on", async () => {
    expect(await countDeadLetters(world().asDb())).toBe(2);
  });
  it("can count for one tenant", async () => {
    expect(await countDeadLetters(world().asDb(), "t1")).toBe(1);
    expect(await countDeadLetters(world().asDb(), "none")).toBe(0);
  });
  it("throws instead of saying zero when the database fails", async () => {
    await expect(
      countDeadLetters(world().fail("event_deliveries", "select").asDb()),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});
describe("resendDeadLetter", () => {
  const NOW = new Date("2026-11-17T10:00:00Z");
  it("puts a given-up delivery back in the queue as new", async () => {
    const db = world();
    expect(await resendDeadLetter(db.asDb(), "t1", { eventId: 1, subscriptionId: "s1" }, NOW)).toBe(
      true,
    );
    expect(db.rows("event_deliveries")[0]).toMatchObject({
      gave_up_at: null,
      attempts: 0,
      next_attempt_at: NOW.toISOString(),
      locked_until: null,
      last_error: null,
      last_status: null,
    });
  });
  it("requeues only the subscription asked for when one event has several", async () => {
    const db = world();
    db.rows("event_deliveries").push(row({ subscription_id: "s2" }));
    expect(await resendDeadLetter(db.asDb(), "t1", { eventId: 1, subscriptionId: "s1" })).toBe(
      true,
    );
    expect(db.rows("event_deliveries")[4]?.["gave_up_at"]).not.toBeNull();
  });
  it("does not touch another tenant's delivery", async () => {
    const db = world();
    expect(await resendDeadLetter(db.asDb(), "t1", { eventId: 2, subscriptionId: "s1" })).toBe(
      false,
    );
    expect(db.rows("event_deliveries")[1]?.["gave_up_at"]).not.toBeNull();
  });
  it("leaves alone a delivery still in progress or already delivered", async () => {
    const db = world();
    expect(await resendDeadLetter(db.asDb(), "t1", { eventId: 3, subscriptionId: "s1" })).toBe(
      false,
    );
    expect(await resendDeadLetter(db.asDb(), "t1", { eventId: 4, subscriptionId: "s1" })).toBe(
      false,
    );
    expect(db.rows("event_deliveries")[2]?.["attempts"]).toBe(2);
  });
  it("answers false for one that does not exist, and throws when the database fails", async () => {
    expect(
      await resendDeadLetter(world().asDb(), "t1", { eventId: 99, subscriptionId: "s1" }),
    ).toBe(false);
    await expect(
      resendDeadLetter(world().fail("event_deliveries", "update").asDb(), "t1", {
        eventId: 1,
        subscriptionId: "s1",
      }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});
describe("the scheduled run reports them", () => {
  it("includes the count, so the scheduler's log can alert on it", async () => {
    const db = world();
    for (const t of ["documents", "document_events", "idempotency_keys", "integration_tokens"])
      db.tables[t] = [];
    expect((await runMaintenance(db.asDb())).deadLetters).toBe(2);
  });
});
