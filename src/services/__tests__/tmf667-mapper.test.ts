import { describe, expect, it } from "vitest";
import {
  eventMatches,
  hasScope,
  isSafeCallback,
  MAX_LIMIT,
  parseListQuery,
  readBearer,
  scopeForTransition,
  selectFields,
  toTmfDocument,
  toTmfEvent,
} from "@/services/tmf667-mapper";

const doc = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Master agreement",
  description: null,
  document_type: "contract",
  status: "approved" as const,
  sensitivity: "confidential",
  legal_hold: false,
  effective_date: "2026-01-01",
  expiry_date: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-02-01T00:00:00Z",
  current_version_id: "v2",
  characteristic: [{ name: "contractNumber", value: "C-1" }, { bad: true }],
};
const versions = [
  { id: "v1", label: "1", mime_type: "application/pdf", size_bytes: 10, content_hash: "a".repeat(64), created_at: "2026-01-01T00:00:00Z" },
  { id: "v2", label: "2", mime_type: "application/pdf", size_bytes: null, content_hash: "b".repeat(64), created_at: "2026-01-02T00:00:00Z" },
];

describe("toTmfDocument", () => {
  it("should map versions to attachments and mark the current one", () => {
    const t = toTmfDocument("https://x.test", doc, versions, [{ entity_id: "O-7731", role: "orderAttachment", referred_type: "ProductOrder" }]);
    expect(t["@type"]).toBe("Document");
    expect(t.href).toBe("https://x.test/api/public/tmf-api/documentManagement/v4/document/11111111-1111-1111-1111-111111111111");
    expect(t.version).toBe("2");
    expect(t.attachment.filter((a) => a.isCurrent).map((a) => a.id)).toEqual(["v2"]);
    expect(t.relatedEntity[0]["@referredType"]).toBe("ProductOrder");
    expect(t.validFor).toEqual({ startDateTime: "2026-01-01" });
  });
  it("should drop malformed characteristics", () => {
    const t = toTmfDocument("https://x.test", doc, versions, []);
    expect(t.characteristic).toEqual([{ name: "contractNumber", value: "C-1" }]);
  });
});

describe("parseListQuery", () => {
  it("should cap limit at the maximum when a larger one is asked", () => {
    const r = parseListQuery(new URLSearchParams("limit=500"));
    expect(r.ok && r.value.limit).toBe(MAX_LIMIT);
  });
  it("should accept a comma list of lifecycle states for the approved-version lookup", () => {
    const r = parseListQuery(new URLSearchParams("relatedEntity.id=O-7731&lifecycleState=approved,effective"));
    expect(r.ok && r.value.lifecycleState).toEqual(["approved", "effective"]);
    expect(r.ok && r.value.relatedEntityId).toBe("O-7731");
  });
  it("should reject an unknown lifecycle state with a 400", () => {
    const r = parseListQuery(new URLSearchParams("lifecycleState=published"));
    expect(!r.ok && r.error.status).toBe("400");
  });
  it("should reject a negative offset", () => {
    expect(parseListQuery(new URLSearchParams("offset=-1")).ok).toBe(false);
  });
});

describe("selectFields", () => {
  it("should always keep id, href and @type", () => {
    expect(Object.keys(selectFields({ id: "1", href: "h", "@type": "Document", name: "n", status: "s" }, ["name"])).sort()).toEqual(["@type", "href", "id", "name"]);
  });
});

describe("scopes", () => {
  it("should need the approve scope to approve", () => {
    expect(scopeForTransition("approved")).toBe("approve");
    expect(scopeForTransition("in_review")).toBe("transition");
  });
  it("should not let a read-only key register documents", () => {
    expect(hasScope(["read"], "register")).toBe(false);
  });
});

describe("readBearer", () => {
  it("should accept only erad_ system keys", () => {
    expect(readBearer("Bearer erad_abcdefghijklmnopqrstuvwxyz")).toBe("erad_abcdefghijklmnopqrstuvwxyz");
    expect(readBearer("Bearer eyJhbGciOi.user.jwt")).toBeNull();
    expect(readBearer(null)).toBeNull();
  });
});

describe("events", () => {
  it("should match subscription filters by eventType", () => {
    expect(eventMatches("eventType=DocumentStateChangeEvent", "DocumentStateChangeEvent")).toBe(true);
    expect(eventMatches("eventType=DocumentStateChangeEvent", "DocumentCreateEvent")).toBe(false);
    expect(eventMatches(null, "DocumentDeleteEvent")).toBe(true);
  });
  it("should never include characteristic values in the event", () => {
    const e = toTmfEvent("https://x.test", { id: 1, event_type: "DocumentStateChangeEvent", document_id: "d1", created_at: "t", payload: { lifecycleState: "approved", secret: "x" } });
    expect(JSON.stringify(e)).not.toContain("secret");
    expect(e.event.document.lifecycleState).toBe("approved");
  });
  it("should refuse non-https or internal callback addresses", () => {
    expect(isSafeCallback("https://ordercare.example.com/hook")).toBe(true);
    expect(isSafeCallback("http://ordercare.example.com/hook")).toBe(false);
    expect(isSafeCallback("https://127.0.0.1/hook")).toBe(false);
    expect(isSafeCallback("https://localhost/hook")).toBe(false);
  });
});
