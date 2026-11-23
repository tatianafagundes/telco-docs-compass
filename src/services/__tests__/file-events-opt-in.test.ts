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
describe("hold flag on change events", () => {
  const row = (payload: unknown) => ({
    id: 1,
    event_type: "DocumentAttributeValueChangeEvent",
    document_id: "d1",
    created_at: "2026-11-24T10:00:00Z",
    payload,
  });
  it("delivers legalHold and says that only the hold changed", () => {
    const e = toTmfEvent("https://x.test", row({ legalHold: true }));
    expect(e).toMatchObject({
      event: { document: { legalHold: true } },
      changedAttributes: ["legalHold"],
    });
  });
  it("never passes anything else from the payload", () => {
    const e = toTmfEvent(
      "https://x.test",
      row({ legalHold: "yes", reason: "dispute", __proto__: { x: 1 } }),
    );
    expect(JSON.stringify(e)).not.toContain("dispute");
    expect(JSON.stringify(e)).not.toContain('legalHold":"yes');
    expect(JSON.stringify(e)).not.toMatch(/"legalHold":/);
  });
});
