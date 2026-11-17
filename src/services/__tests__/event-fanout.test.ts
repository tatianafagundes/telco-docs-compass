// Spec telco-docs-compass-hardening, tasks 1.3 and 2.5 (R4.1).
//
// Rule: an event leaves the outbox (delivered_at set) only after it was handed to every matching
// subscriber's delivery queue. If we could not even read the subscribers, the event must stay
// pending so the next pass retries it. Marking it delivered would lose it for good.
import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { deliverPending } from "@/services/tmf-events";

function world() {
  return new FakeDb({
    event_outbox: [
      {
        id: 1,
        tenant_id: "t1",
        event_type: "DocumentCreateEvent",
        document_id: "doc-1",
        created_at: "2026-11-10T10:00:00Z",
        delivered_at: null,
      },
    ],
    event_subscriptions: [
      {
        id: 7,
        tenant_id: "t1",
        query: null,
        created_at: "2026-11-01T00:00:00Z",
        integration_clients: { revoked_at: null },
      },
    ],
    documents: [{ id: "doc-1", status: "draft", document_type: "contract" }],
    event_deliveries: [],
  }).onRpc("claim_event_deliveries", []);
}

const outboxDeliveredAt = (db: FakeDb) => db.rows("event_outbox")[0]?.["delivered_at"];

describe("event fan-out", () => {
  it("queues one delivery per matching subscriber and then marks the event handed over (control)", async () => {
    const db = world();
    const result = await deliverPending(db.asDb(), "https://app.example");
    expect(result.fannedOut).toBe(1);
    expect(db.rows("event_deliveries")).toEqual([
      { event_id: 1, subscription_id: 7, tenant_id: "t1" },
    ]);
    expect(outboxDeliveredAt(db)).not.toBeNull();
  });

  it("keeps the event pending when the subscribers cannot be read", async () => {
    const db = world().fail("event_subscriptions", "select", "connection reset");
    await deliverPending(db.asDb(), "https://app.example");
    expect(outboxDeliveredAt(db)).toBeNull();
  });

  it("keeps the event pending when the document facts cannot be read", async () => {
    // Without them a status/type filter on a subscription could not be applied.
    const db = world().fail("documents", "select", "connection reset");
    await deliverPending(db.asDb(), "https://app.example");
    expect(outboxDeliveredAt(db)).toBeNull();
    expect(db.rows("event_deliveries")).toEqual([]);
  });

  it("keeps the event pending when queueing the deliveries fails", async () => {
    const db = world().fail("event_deliveries", "upsert", "disk full");
    await deliverPending(db.asDb(), "https://app.example");
    expect(outboxDeliveredAt(db)).toBeNull();
  });
});

describe("delivery pass", () => {
  // One delivery is already claimed. Its event and subscription are read before sending.
  function claimedWorld() {
    return new FakeDb({
      event_outbox: [
        {
          id: 1,
          tenant_id: "t1",
          event_type: "DocumentCreateEvent",
          document_id: "doc-1",
          created_at: "2026-11-10T10:00:00Z",
          delivered_at: "2026-11-10T10:01:00Z",
          payload: {},
        },
      ],
      event_subscriptions: [
        {
          id: 7,
          tenant_id: "t1",
          callback: "https://example.invalid/hook",
          query: null,
          secret: "s",
        },
      ],
      event_deliveries: [
        {
          event_id: 1,
          subscription_id: 7,
          tenant_id: "t1",
          attempts: 0,
          gave_up_at: null,
          locked_until: "2026-11-10T11:00:00Z",
        },
      ],
      documents: [],
    }).onRpc("claim_event_deliveries", [
      { event_id: 1, subscription_id: 7, tenant_id: "t1", attempts: 0 },
    ]);
  }
  const delivery = (db: FakeDb) => db.rows("event_deliveries")[0] as Record<string, unknown>;

  it("counts a missing event as a failed attempt that backs off, instead of dropping it at once", async () => {
    const db = claimedWorld();
    db.tables["event_outbox"] = [];
    await deliverPending(db.asDb(), "https://app.example");
    expect(delivery(db)["gave_up_at"]).toBeNull();
    expect(delivery(db)["attempts"]).toBe(1);
    expect(Date.parse(String(delivery(db)["next_attempt_at"]))).toBeGreaterThan(Date.now());
  });

  it("gives up a delivery that is missing its event after the last attempt", async () => {
    const db = claimedWorld();
    db.tables["event_outbox"] = [];
    delivery(db)["attempts"] = 5;
    db.onRpc("claim_event_deliveries", [
      { event_id: 1, subscription_id: 7, tenant_id: "t1", attempts: 5 },
    ]);
    await deliverPending(db.asDb(), "https://app.example");
    expect(delivery(db)["gave_up_at"]).not.toBeNull();
  });

  it("gives up at once when the event and the subscription belong to different tenants", async () => {
    const db = claimedWorld();
    db.rows("event_subscriptions")[0]!["tenant_id"] = "t2";
    await deliverPending(db.asDb(), "https://app.example");
    expect(delivery(db)["gave_up_at"]).not.toBeNull();
    expect(delivery(db)["attempts"]).toBe(0); // nothing was sent
  });

  it("does NOT give up a delivery when the event or subscription could not be read", async () => {
    for (const table of ["event_outbox", "event_subscriptions"]) {
      const db = claimedWorld().fail(table, "select", "connection reset");
      await deliverPending(db.asDb(), "https://app.example");
      expect(delivery(db)["gave_up_at"], table).toBeNull();
      expect(delivery(db)["locked_until"], table).toBeNull(); // released, so the next pass retries it
      expect(delivery(db)["attempts"], table).toBe(0);
      // Cooldown: not claimable again until the first backoff step has passed (no hot loop).
      expect(Date.parse(String(delivery(db)["next_attempt_at"])), table).toBeGreaterThan(
        Date.now(),
      );
    }
  });

  it("reports how many deliveries it gave back, and leaves one alone that another pass has since taken", async () => {
    const db = claimedWorld().fail("event_subscriptions", "select", "connection reset");
    // Our claim saw this lock; by now another pass holds the row under a different lock.
    db.onRpc("claim_event_deliveries", [
      { event_id: 1, subscription_id: 7, tenant_id: "t1", attempts: 0, locked_until: "old-lock" },
    ]);
    const result = await deliverPending(db.asDb(), "https://app.example");
    expect(result.deferred).toBe(1);
    expect(delivery(db)["locked_until"]).toBe("2026-11-10T11:00:00Z"); // untouched
  });
});
