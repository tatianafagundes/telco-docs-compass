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
    expect(t["@type"]).toBe("EradDocument");
    expect(t["@baseType"]).toBe("Document");
    expect(t.href).toBe("https://x.test/api/public/tmf-api/document/v4/document/11111111-1111-1111-1111-111111111111");
    expect(t.version).toBe("2");
    expect(t.attachment.filter((a) => a.isCurrent).map((a) => a.id)).toEqual(["v2"]);
    expect(t.relatedEntity[0]?.["@referredType"]).toBe("ProductOrder");
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
    expect(e.event.document).toMatchObject({ status: "approved", lifecycleState: "approved" });
  });
  it("should refuse non-https or internal callback addresses", () => {
    expect(isSafeCallback("https://ordercare.example.com/hook")).toBe(true);
    expect(isSafeCallback("http://ordercare.example.com/hook")).toBe(false);
    expect(isSafeCallback("https://127.0.0.1/hook")).toBe(false);
    expect(isSafeCallback("https://localhost/hook")).toBe(false);
  });
});

import {
  eventNameFor,
  isPrivateIp,
  signedPayload,
  statesForTmfStatus,
  targetForTmfStatus,
  toStandardReferredType,
  toTmfStatus,
  toTmfSpecification,
} from "@/services/tmf667-mapper";

describe("TMF667 v4 status", () => {
  it("should map every internal state to the v4 DocumentStatusType", () => {
    expect(toTmfStatus("draft")).toBe("created");
    expect(toTmfStatus("in_review")).toBe("reviewed");
    expect(toTmfStatus("approved")).toBe("approved");
    expect(toTmfStatus("effective")).toBe("published");
    expect(toTmfStatus("superseded")).toBe("archived");
    expect(toTmfStatus("expired")).toBe("archived");
    expect(toTmfStatus("archived")).toBe("archived");
    expect(toTmfStatus("effective", true)).toBe("deleted");
  });
  it("should expand a status filter to every matching internal state", () => {
    expect(statesForTmfStatus("archived").sort()).toEqual(["archived", "expired", "superseded"]);
    expect(statesForTmfStatus("published")).toEqual(["effective"]);
  });
  it("should accept status= in list queries and intersect it with lifecycleState", () => {
    const r = parseListQuery(new URLSearchParams("status=approved,published"));
    expect(r.ok && r.value.lifecycleState?.sort()).toEqual(["approved", "effective"]);
    const both = parseListQuery(new URLSearchParams("status=archived&lifecycleState=expired,draft"));
    expect(both.ok && both.value.lifecycleState).toEqual(["expired"]);
    expect(parseListQuery(new URLSearchParams("status=bogus")).ok).toBe(false);
  });
  it("should map PATCH status targets and refuse deleted", () => {
    expect(targetForTmfStatus("reviewed")).toBe("in_review");
    expect(targetForTmfStatus("published")).toBe("effective");
    expect(targetForTmfStatus("deleted")).toBeNull();
  });
  it("should return status and lifecycleState on documents", () => {
    const t = toTmfDocument("https://x.test", { ...doc, status: "effective" }, versions, []);
    expect(t.status).toBe("published");
    expect(t.lifecycleState).toBe("effective");
  });
});

describe("TMF667 v4 data model", () => {
  it("should give each attachment a url, href and attachmentType", () => {
    const t = toTmfDocument("https://x.test", doc, versions, []);
    expect(t.attachment[0]?.url).toBe(`https://x.test/api/public/tmf-api/document/v4/document/${doc.id}/attachment/v1/content`);
    expect(t.attachment[0]?.attachmentType).toBe("contract");
  });
  it("should use SID names for referred types", () => {
    expect(toStandardReferredType("Account")).toBe("BillingAccount");
    const t = toTmfDocument("https://x.test", doc, versions, [{ entity_id: "acc-1", role: "subject", referred_type: "Account" }]);
    expect(t.relatedEntity[0]?.["@referredType"]).toBe("BillingAccount");
    const q = parseListQuery(new URLSearchParams("relatedEntity.@referredType=BillingAccount"));
    expect(q.ok && q.value.referredType).toBe("Account");
  });
  it("should carry the owner and external identifiers", () => {
    const t = toTmfDocument("https://x.test", { ...doc, tenant_id: "aurora-se", external_identifier: [{ id: "Q-1", owner: "CPQ" }, { nope: 1 }] }, versions, []);
    expect(t.relatedParty).toEqual([{ id: "aurora-se", role: "owner", "@referredType": "Organization", "@type": "RelatedParty" }]);
    expect(t.externalIdentifier).toEqual([{ id: "Q-1", owner: "CPQ", "@type": "ExternalIdentifier" }]);
  });
  it("should express file rules as specCharacteristic", () => {
    const s = toTmfSpecification("https://x.test", { id: "1", code: "quote", name: "Quote", version: "1", lifecycle_status: "active", definition: { acceptedMimeTypes: ["application/pdf"], maxSizeMb: 20 } });
    const names = s.specCharacteristic.map((c) => (c as { name: string }).name);
    expect(names).toEqual(["acceptedMimeType", "maxSizeMb"]);
  });
});

describe("TMF667 v4 events", () => {
  it("should send v4 event names by default", () => {
    expect(eventNameFor(null, "DocumentStateChangeEvent")).toBe("DocumentChangeEvent");
    expect(eventNameFor(null, "DocumentAttributeValueChangeEvent")).toBe("DocumentChangeEvent");
    expect(eventNameFor(null, "DocumentDeleteEvent")).toBe("DocumentDeleteEvent");
  });
  it("should keep the old name for subscriptions that asked for it", () => {
    expect(eventNameFor("eventType=DocumentStateChangeEvent", "DocumentStateChangeEvent")).toBe("DocumentStateChangeEvent");
  });
  it("should match v4 names, status and documentType filters", () => {
    expect(eventMatches("eventType=DocumentChangeEvent", "DocumentStateChangeEvent")).toBe(true);
    expect(eventMatches("eventType=DocumentChangeEvent&status=published", "DocumentStateChangeEvent", { status: "effective" })).toBe(true);
    expect(eventMatches("eventType=DocumentChangeEvent&status=published", "DocumentStateChangeEvent", { status: "draft" })).toBe(false);
    expect(eventMatches("documentType=quote", "DocumentCreateEvent", { documentType: "contract" })).toBe(false);
  });
  it("should fill the v4 envelope fields", () => {
    const e = toTmfEvent("https://x.test", { id: 7, event_type: "DocumentStateChangeEvent", document_id: "d1", created_at: "2026-11-10T00:00:00Z", payload: { lifecycleState: "effective" } });
    expect(e).toMatchObject({ eventType: "DocumentChangeEvent", correlationId: "d1", domain: "documentManagement", priority: "normal", timeOcurred: "2026-11-10T00:00:00Z", changedAttributes: ["status"] });
  });
  it("should sign timestamp and body together", () => {
    expect(signedPayload("1700000000", "{}")).toBe("1700000000.{}");
  });
});

describe("callback address checks", () => {
  it("should treat private, loopback, link-local and CGNAT addresses as private", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.1.1", "172.20.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "2606:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
  });
});

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
import { DEFAULT_LIMIT, fromStandardReferredType, LEGACY_BASE_PATH, LEGACY_SUNSET, SCOPES, TMF_BASE_PATH } from "@/services/tmf667-mapper";

describe("BR-126/BR-127 event envelope", () => {
  it("BR-126 events carry id, href and status only, never document content", () => {
    const e = toTmfEvent("https://x.test", {
      id: 3, event_type: "DocumentAttributeValueChangeEvent", document_id: "d1", created_at: "t",
      payload: { lifecycleState: "draft", name: "Secret name", characteristic: [{ name: "contractNumber", value: "C-9" }] },
    });
    expect(Object.keys(e.event.document).sort()).toEqual(["@type", "href", "id", "lifecycleState", "status"]);
    expect(e).toMatchObject({ event: { document: { href: "https://x.test/api/public/tmf-api/document/v4/document/d1" } } });
    expect(JSON.stringify(e)).not.toContain("Secret name");
    expect(JSON.stringify(e)).not.toContain("C-9");
  });
  it("BR-127 changed attributes per event kind and 'deleted' on a delete event", () => {
    const attr = toTmfEvent("https://x.test", { id: 1, event_type: "DocumentAttributeValueChangeEvent", document_id: "d1", created_at: "t", payload: {} });
    expect(attr).toMatchObject({ changedAttributes: ["attachment", "characteristic", "legalHold"] });
    const state = toTmfEvent("https://x.test", { id: 2, event_type: "DocumentStateChangeEvent", document_id: "d1", created_at: "t", payload: {} });
    expect(state).toMatchObject({ changedAttributes: ["status"] });
    const created = toTmfEvent("https://x.test", { id: 3, event_type: "DocumentCreateEvent", document_id: "d1", created_at: "t", payload: {} });
    expect(created.eventType).toBe("DocumentCreateEvent");
    expect("changedAttributes" in created).toBe(false);
    const del = toTmfEvent("https://x.test", { id: 4, event_type: "DocumentDeleteEvent", document_id: "d1", created_at: "t", payload: { lifecycleState: "effective" } });
    expect(del.eventType).toBe("DocumentDeleteEvent");
    expect(del.event.document).toEqual({ id: "d1", href: "https://x.test/api/public/tmf-api/document/v4/document/d1", "@type": "Document", status: "deleted" });
  });
  it("BR-127 internal names are delivered as v4 DocumentChangeEvent unless the subscription asked for the old name", () => {
    expect(toTmfEvent("https://x.test", { id: 5, event_type: "DocumentStateChangeEvent", document_id: "d1", created_at: "t", payload: {} }).eventType).toBe("DocumentChangeEvent");
    expect(toTmfEvent("https://x.test", { id: 5, event_type: "DocumentAttributeValueChangeEvent", document_id: "d1", created_at: "t", payload: {} }, "eventType=DocumentAttributeValueChangeEvent").eventType).toBe("DocumentAttributeValueChangeEvent");
  });
});

describe("BR-131/BR-132/BR-133/BR-134 mapping tables", () => {
  it("BR-131 PATCH status targets, every value, and refusal of anything else", () => {
    expect(targetForTmfStatus("created")).toBe("draft");
    expect(targetForTmfStatus("reviewed")).toBe("in_review");
    expect(targetForTmfStatus("approved")).toBe("approved");
    expect(targetForTmfStatus("published")).toBe("effective");
    expect(targetForTmfStatus("archived")).toBe("archived");
    for (const bad of ["deleted", "effective", "in_review", "Published", ""]) expect(targetForTmfStatus(bad)).toBeNull();
  });
  it("BR-132 scopes are read, register, transition, approve, hold, delete and subscribe", () => {
    expect([...SCOPES]).toEqual(["read", "register", "transition", "approve", "hold", "delete", "subscribe"]);
    for (const to of ["in_review", "effective", "superseded", "expired", "archived"] as const) expect(scopeForTransition(to)).toBe("transition");
    expect(hasScope(["read", "approve"], "approve")).toBe(true);
  });
  it("BR-133 BillingAccount maps back to Account and other types pass through", () => {
    expect(fromStandardReferredType("BillingAccount")).toBe("Account");
    expect(fromStandardReferredType("ProductOrder")).toBe("ProductOrder");
    expect(toStandardReferredType("Quote")).toBe("Quote");
  });
  it("BR-134 paging: default limit 20, max 100", () => {
    expect(DEFAULT_LIMIT).toBe(20);
    expect(MAX_LIMIT).toBe(100);
    const r = parseListQuery(new URLSearchParams(""));
    expect(r.ok && r.value).toMatchObject({ offset: 0, limit: 20 });
    const capped = parseListQuery(new URLSearchParams("limit=101"));
    expect(capped.ok && capped.value.limit).toBe(100);
    expect(parseListQuery(new URLSearchParams("limit=0")).ok).toBe(false);
  });
});

describe("BR-136/BR-139 keys and legacy base", () => {
  it("BR-136 bearer prefixes: erad_ keys and eradt_ tokens are accepted, anything else is not", () => {
    expect(readBearer("Bearer eradt_abcdefghijklmnopqrstuvwxyz")).toBe("eradt_abcdefghijklmnopqrstuvwxyz");
    expect(readBearer("Bearer erad_short")).toBeNull();
    expect(readBearer("erad_abcdefghijklmnopqrstuvwxyz")).toBeNull();
  });
  it("BR-139 the legacy base /documentManagement/v4 stays an alias with a sunset of 10 May 2027", () => {
    expect(TMF_BASE_PATH).toBe("/api/public/tmf-api/document/v4");
    expect(LEGACY_BASE_PATH).toBe("/api/public/tmf-api/documentManagement/v4");
    expect(LEGACY_SUNSET).toBe("Mon, 10 May 2027 00:00:00 GMT");
  });
});
