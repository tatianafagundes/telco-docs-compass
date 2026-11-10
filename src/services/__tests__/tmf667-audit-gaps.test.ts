import { describe, expect, it } from "vitest";
import { categoryFromDefinition, eventMatches, toTmfDocument, toTmfEvent, toTmfSpecification } from "@/services/tmf667-mapper";
import { systemMayApprove } from "@/services/document-rules";

const doc = {
  id: "d1", name: "Quote", description: null, document_type: "quote", status: "draft" as const, sensitivity: "internal",
  legal_hold: false, effective_date: null, expiry_date: null, created_at: "2026-01-01", updated_at: "2026-01-01",
  current_version_id: null, characteristic: [],
};

describe("systemMayApprove", () => {
  it("should refuse when the same key registered the document", () => expect(systemMayApprove("k1", "k1")).toBe(false));
  it("should allow another key", () => expect(systemMayApprove("k1", "k2")).toBe(true));
  it("should allow documents added in the app", () => expect(systemMayApprove(null, "k1")).toBe(true));
});

describe("document refs and category", () => {
  it("should return bundle siblings as DocumentRef", () => {
    const t = toTmfDocument("https://x.test", doc, [], [], { related: [{ id: "d2", role: "annex" }], category: ["Manage Contract"] });
    expect(t.document).toEqual([{ id: "d2", href: "https://x.test/api/public/tmf-api/document/v4/document/d2", role: "annex", "@referredType": "Document", "@type": "DocumentRef" }]);
    expect(t.category).toEqual(["Manage Contract"]);
  });
  it("should omit document and category when empty", () => {
    const t = toTmfDocument("https://x.test", doc, [], []);
    expect(t.document).toBeUndefined();
    expect(t.category).toBeUndefined();
  });
  it("should read business process names", () => {
    expect(categoryFromDefinition({ businessProcess: [{ name: "Negotiate Sales/Contract" }, { id: "x" }] })).toEqual(["Negotiate Sales/Contract"]);
  });
});

describe("document specification", () => {
  it("should include isBundle false and targetEntitySchema", () => {
    const s = toTmfSpecification("https://x.test", { id: "1", code: "quote", name: "Quote", version: "1", lifecycle_status: "active", definition: {} });
    expect(s.isBundle).toBe(false);
    expect(s.targetEntitySchema["@type"]).toBe("EradDocument");
  });
});

describe("DocumentBatchEvent", () => {
  it("should go only to subscriptions that name it", () => {
    expect(eventMatches(null, "DocumentBatchEvent")).toBe(false);
    expect(eventMatches("eventType=DocumentChangeEvent", "DocumentBatchEvent")).toBe(false);
    expect(eventMatches("eventType=DocumentBatchEvent", "DocumentBatchEvent")).toBe(true);
  });
  it("should list every document id in the envelope", () => {
    const e = toTmfEvent("https://x.test", { id: 9, event_type: "DocumentBatchEvent", document_id: "a", created_at: "t", payload: { documentIds: ["a", "b"] } });
    expect(e.eventType).toBe("DocumentBatchEvent");
    expect((e.event.document as { id: string }[]).map((d) => d.id)).toEqual(["a", "b"]);
  });
});
