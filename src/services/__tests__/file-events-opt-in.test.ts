// File events are opt-in: an existing subscription that does not name them must not start receiving
// them when the file-event trigger begins writing them (R1.5). The hold flag is delivered (D6).
import { describe, expect, it } from "vitest";
import { eventMatches, OPT_IN_EVENTS, toTmfEvent } from "@/services/tmf667-events";
const FILE = ["DocumentFileStoredEvent", "DocumentFileReadyToReadEvent", "DocumentFilePurgedEvent"];
describe("file events are opt-in", () => {
  it.each(FILE)("%s reaches only subscriptions that name it exactly", (type) => {
    expect(OPT_IN_EVENTS.has(type)).toBe(true);
    for (const q of [
      null,
      "",
      "status=approved",
      "eventType=DocumentChangeEvent",
      `eventType=${type.toLowerCase()}`,
    ])
      expect(eventMatches(q, type), String(q)).toBe(false);
    expect(eventMatches(`eventType=${type}`, type)).toBe(true);
    expect(eventMatches(`eventType=DocumentChangeEvent,${type}`, type)).toBe(true);
  });
  it("leaves the standard events as they were", () => {
    expect(eventMatches(null, "DocumentStateChangeEvent")).toBe(true);
    expect(eventMatches(null, "DocumentBatchEvent")).toBe(false);
  });
});
describe("opt-in events still honour the subscription filters", () => {
  it("does not send a file event for another document type", () => {
    const q = "eventType=DocumentFileStoredEvent&documentType=contract";
    expect(eventMatches(q, "DocumentFileStoredEvent", { documentType: "invoice" })).toBe(false);
    expect(eventMatches(q, "DocumentFileStoredEvent", { documentType: "contract" })).toBe(true);
  });
});
describe("hold change on change events", () => {
  const row = (payload: unknown) => ({
    id: 1,
    event_type: "DocumentAttributeValueChangeEvent",
    document_id: "d1",
    created_at: "2026-11-24T10:00:00Z",
    payload,
  });
  it("names legalHold as the changed attribute without sending its value", () => {
    const e = toTmfEvent("https://x.test", row({ changed: "legalHold" }));
    expect(e).toMatchObject({ changedAttributes: ["legalHold"] });
    expect(JSON.stringify(e)).not.toMatch(/"legalHold":/);
  });
  it("never passes anything else from the payload", () => {
    const e = toTmfEvent(
      "https://x.test",
      row({ changed: "legalHold", legalHold: true, reason: "dispute" }),
    );
    expect(JSON.stringify(e)).not.toContain("dispute");
    expect(JSON.stringify(e)).not.toMatch(/"legalHold":/);
  });
});
describe("file events carry the whitelisted file facts", () => {
  const V = "11111111-1111-4111-8111-111111111111";
  it("delivers versionId and attempt, and nothing the payload adds", () => {
    const e = toTmfEvent("https://x.test", {
      id: 2,
      event_type: "DocumentFileReadyToReadEvent",
      document_id: "d1",
      created_at: "2026-11-24T10:00:00Z",
      payload: { versionId: V, attempt: 2, name: "Secret plan.pdf" },
    });
    expect(e.event).toMatchObject({ file: { versionId: V, attempt: 2 } });
    expect(JSON.stringify(e)).not.toContain("Secret plan");
  });
  it("keeps the standard events without a file part", () => {
    const e = toTmfEvent("https://x.test", {
      id: 3,
      event_type: "DocumentCreateEvent",
      document_id: "d1",
      created_at: "2026-11-24T10:00:00Z",
      payload: { lifecycleState: "draft", versionId: V },
    });
    expect(e.event).not.toHaveProperty("file");
  });
});
