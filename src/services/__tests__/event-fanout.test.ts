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

  it("keeps the event pending when queueing the deliveries fails", async () => {
    const db = world().fail("event_deliveries", "upsert", "disk full");
    await deliverPending(db.asDb(), "https://app.example");
    expect(outboxDeliveredAt(db)).toBeNull();
  });
});
