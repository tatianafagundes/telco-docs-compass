import { describe, expect, it } from "vitest";
import {
  can,
  contentLocked,
  deleteBlocker,
  hashBody,
  idempotencyOutcome,
  isTransitionAllowed,
  pendingRequiredDetails,
  transitionCapability,
} from "@/services/document-rules";
import { RECORDABLE_ACTIONS } from "@/services/document.functions";

describe("document-rules", () => {
  it("should allow the forward status path", () => {
    expect(isTransitionAllowed("draft", "in_review")).toBe(true);
    expect(isTransitionAllowed("in_review", "approved")).toBe(true);
    expect(isTransitionAllowed("approved", "effective")).toBe(true);
    expect(isTransitionAllowed("effective", "superseded")).toBe(true);
    expect(isTransitionAllowed("effective", "expired")).toBe(true);
    expect(isTransitionAllowed("expired", "archived")).toBe(true);
  });

  it("should refuse skipping steps and going back through transition", () => {
    expect(isTransitionAllowed("draft", "approved")).toBe(false);
    expect(isTransitionAllowed("in_review", "draft")).toBe(false); // only via reportProblem sendBack
    expect(isTransitionAllowed("archived", "effective")).toBe(false);
  });

  it("should require reviewer to approve and manager to make effective", () => {
    expect(can("contributor", transitionCapability("approved"))).toBe(false);
    expect(can("reviewer", transitionCapability("approved"))).toBe(true);
    expect(can("reviewer", transitionCapability("effective"))).toBe(false);
    expect(can("manager", transitionCapability("effective"))).toBe(true);
    expect(can("viewer", "edit")).toBe(false);
  });

  it("should block approve while a required detail is pending", () => {
    const spec = [
      { name: "contractNumber", required: true, extractable: true },
      { name: "endDate", required: true, extractable: true },
      { name: "renewalTermMonths", extractable: true },
    ];
    expect(
      pendingRequiredDetails(spec, [
        { name: "contractNumber", status: "accepted" },
        { name: "endDate", status: "pending" },
        { name: "renewalTermMonths", status: "pending" },
      ]),
    ).toEqual(["endDate"]);
    expect(
      pendingRequiredDetails(spec, [
        { name: "contractNumber", status: "edited" },
        { name: "endDate", status: "accepted" },
      ]),
    ).toEqual([]);
  });

  it("should block delete under legal hold with the hold reason", () => {
    const b = deleteBlocker({
      legalHold: true, holdReason: "Pending dispute ref. DSP-2026-031", retainUntil: null,
      createdAt: "2020-01-01T00:00:00Z", minRetentionDays: null, today: "2026-11-10",
    });
    expect(b?.code).toBe("doc.delete.legalHold");
    expect(b?.customerFacing?.detail).toBe("Pending dispute ref. DSP-2026-031");
  });

  it("should block delete under retention and the master 1825-day floor", () => {
    expect(deleteBlocker({
      legalHold: false, holdReason: null, retainUntil: "2038-02-28",
      createdAt: "2020-01-01T00:00:00Z", minRetentionDays: null, today: "2026-11-10",
    })?.code).toBe("doc.delete.retention");
    expect(deleteBlocker({
      legalHold: false, holdReason: null, retainUntil: null,
      createdAt: "2026-11-05T00:00:00Z", minRetentionDays: 1825, today: "2026-11-10",
    })?.code).toBe("doc.delete.retention");
    expect(deleteBlocker({
      legalHold: false, holdReason: null, retainUntil: null,
      createdAt: "2019-01-01T00:00:00Z", minRetentionDays: 1825, today: "2026-11-10",
    })).toBeNull();
  });

  it("should lock content while scanning or quarantined", () => {
    expect(contentLocked("scanning")).toBe(true);
    expect(contentLocked("quarantined")).toBe(true);
    expect(contentLocked("ready")).toBe(false);
  });

  it("should replay the same body and conflict on a different body", async () => {
    const h1 = await hashBody({ id: "a", to: "approved" });
    const h1Reordered = await hashBody({ to: "approved", id: "a" });
    const h2 = await hashBody({ id: "a", to: "effective" });
    expect(h1).toBe(h1Reordered);
    expect(idempotencyOutcome(null, h1).kind).toBe("fresh");
    expect(idempotencyOutcome({ request_hash: h1, response: { ok: true } }, h1Reordered).kind).toBe("replay");
    expect(idempotencyOutcome({ request_hash: h1, response: { ok: true } }, h2).kind).toBe("conflict");
  });

  it("should let clients record only view and download", () => {
    expect([...RECORDABLE_ACTIONS]).toEqual(["view", "download"]);
  });
});

import { contentProtected, metadataPatchAllowed } from "@/services/document-rules";

describe("approved content protection", () => {
  it("should allow renaming an effective document", () => {
    expect(metadataPatchAllowed("effective", ["name", "description"])).toEqual({ ok: true });
  });
  it("should allow renaming an approved document", () => {
    expect(metadataPatchAllowed("approved", ["name"])).toEqual({ ok: true });
  });
  it("should block changing confirmed details on an effective document", () => {
    expect(metadataPatchAllowed("effective", ["name", "characteristic"])).toEqual({ ok: false, reason: "approvedContent", blocked: ["characteristic"] });
  });
  it("should block changing the expiry date on an approved document", () => {
    expect(metadataPatchAllowed("approved", ["expiryDate"])).toEqual({ ok: false, reason: "approvedContent", blocked: ["expiryDate"] });
  });
  it("should allow content changes while in draft or review", () => {
    expect(metadataPatchAllowed("draft", ["characteristic", "expiryDate"])).toEqual({ ok: true });
    expect(metadataPatchAllowed("in_review", ["characteristic"])).toEqual({ ok: true });
  });
  it("should keep superseded documents fully closed, even for names", () => {
    expect(metadataPatchAllowed("superseded", ["name"])).toEqual({ ok: false, reason: "frozen" });
  });
  it("should protect file versions only once approved or effective", () => {
    expect(contentProtected("approved")).toBe(true);
    expect(contentProtected("effective")).toBe(true);
    expect(contentProtected("in_review")).toBe(false);
  });
});

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
import {
  ALLOWED_TRANSITIONS,
  DOWNLOAD_URL_SECONDS,
  FROZEN_STATUSES,
  IDEMPOTENCY_TTL_HOURS,
  isFrozen,
  PREVIEW_URL_SECONDS,
  stableStringify,
  type AppRole,
  type Capability,
} from "@/services/document-rules";

describe("BR-001/BR-002 roles and capabilities", () => {
  const ROLES: AppRole[] = ["viewer", "contributor", "reviewer", "manager", "tenant_admin", "master_admin"];
  const CAPS: Capability[] = ["edit", "review", "manage"];
  it("BR-001 role rank: viewer < contributor < reviewer < manager < tenant_admin = master_admin", () => {
    const table = Object.fromEntries(ROLES.map((r) => [r, CAPS.filter((c) => can(r, c))]));
    expect(table).toEqual({
      viewer: [],
      contributor: ["edit"],
      reviewer: ["edit", "review"],
      manager: ["edit", "review", "manage"],
      tenant_admin: ["edit", "review", "manage"],
      master_admin: ["edit", "review", "manage"],
    });
  });
  it("BR-002 edit needs contributor, review needs reviewer, manage needs manager", () => {
    expect(can("viewer", "edit")).toBe(false);
    expect(can("contributor", "edit")).toBe(true);
    expect(can("contributor", "review")).toBe(false);
    expect(can("reviewer", "review")).toBe(true);
    expect(can("reviewer", "manage")).toBe(false);
    expect(can("manager", "manage")).toBe(true);
  });
});

describe("BR-010/BR-012/BR-013 status path", () => {
  it("BR-010 allowed transitions table is exactly the spec's", () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      draft: ["in_review"],
      in_review: ["approved"],
      approved: ["effective"],
      effective: ["superseded", "expired"],
      superseded: ["archived"],
      expired: ["archived"],
      archived: [],
    });
    expect(isTransitionAllowed("superseded", "archived")).toBe(true);
    for (const to of ["draft", "in_review", "approved", "effective", "superseded", "expired", "archived"] as const) {
      expect(isTransitionAllowed("archived", to)).toBe(false);
    }
  });
  it("BR-012 capability per target: in_review edit, approved review, every other target manage", () => {
    expect(transitionCapability("in_review")).toBe("edit");
    expect(transitionCapability("approved")).toBe("review");
    for (const to of ["draft", "effective", "superseded", "expired", "archived"] as const) expect(transitionCapability(to)).toBe("manage");
  });
  it("BR-013 frozen statuses are superseded, expired and archived", () => {
    expect(FROZEN_STATUSES).toEqual(["superseded", "expired", "archived"]);
    expect(isFrozen("superseded")).toBe(true);
    expect(isFrozen("expired")).toBe(true);
    expect(isFrozen("archived")).toBe(true);
    for (const s of ["draft", "in_review", "approved", "effective"] as const) expect(isFrozen(s)).toBe(false);
  });
});

describe("BR-050 delete blockers in order with their details", () => {
  const facts = { legalHold: false, holdReason: null, retainUntil: null, createdAt: "2026-11-05T00:00:00Z", minRetentionDays: null, today: "2026-11-10" };
  it("BR-050 legal hold wins over retention and the floor, detail is the hold reason", () => {
    const b = deleteBlocker({ ...facts, legalHold: true, holdReason: "Dispute DSP-1", retainUntil: "2038-02-28", minRetentionDays: 1825 });
    expect(b?.code).toBe("doc.delete.legalHold");
    expect(b?.customerFacing?.detail).toBe("Dispute DSP-1");
  });
  it("BR-050 retain_until later than today wins over the floor, detail is the date", () => {
    const b = deleteBlocker({ ...facts, retainUntil: "2038-02-28", minRetentionDays: 1825 });
    expect(b?.code).toBe("doc.delete.retention");
    expect(b?.customerFacing?.detail).toBe("2038-02-28");
  });
  it("BR-050 created_at + minRetentionDays later than today blocks with the floor date as detail", () => {
    const b = deleteBlocker({ ...facts, minRetentionDays: 1825 });
    expect(b?.code).toBe("doc.delete.retention");
    expect(b?.customerFacing?.detail).toBe("2031-11-04");
  });
  it("BR-050 retain_until equal to today does not block a soft delete", () => {
    expect(deleteBlocker({ ...facts, retainUntil: "2026-11-10" })).toBeNull();
  });
});

describe("BR-061 signed URL lifetimes", () => {
  it("BR-061 preview URL lives 300 s and download URL lives 60 s", () => {
    expect(PREVIEW_URL_SECONDS).toBe(300);
    expect(DOWNLOAD_URL_SECONDS).toBe(60);
  });
});

describe("BR-070/BR-071/BR-072 idempotency", () => {
  it("BR-070 stable JSON form sorts keys and drops undefined, hash is SHA-256 hex", async () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [1, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[1,{"y":2,"z":1}]},"b":1}');
    expect(stableStringify(null)).toBe("null");
    expect(await hashBody({ x: 1, y: undefined })).toBe(await hashBody({ x: 1 }));
    expect(await hashBody({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
  it("BR-071 same hash replays the stored response", async () => {
    const h = await hashBody({ id: "a" });
    expect(idempotencyOutcome({ request_hash: h, response: { ok: true, data: { id: "a" } } }, h)).toEqual({ kind: "replay", response: { ok: true, data: { id: "a" } } });
  });
  it("BR-072 idempotency keys expire after 24 h", () => {
    expect(IDEMPOTENCY_TTL_HOURS).toBe(24);
  });
});

describe("BR-143 approved content protection details", () => {
  it("BR-143 name, description, sensitivity and record links stay editable once approved", () => {
    expect(metadataPatchAllowed("approved", ["name", "description", "sensitivity", "externalIdentifier", "relatedEntity"])).toEqual({ ok: true });
    expect(metadataPatchAllowed("effective", [])).toEqual({ ok: true });
  });
  it("BR-143 confirmed details, dates and file versions are blocked, listing every blocked field", () => {
    expect(metadataPatchAllowed("effective", ["characteristic", "expiryDate", "validFor", "attachment"])).toEqual({
      ok: false,
      reason: "approvedContent",
      blocked: ["characteristic", "expiryDate", "validFor", "attachment"],
    });
  });
  it("BR-143 expired and archived documents stay fully closed", () => {
    expect(metadataPatchAllowed("expired", ["name"])).toEqual({ ok: false, reason: "frozen" });
    expect(metadataPatchAllowed("archived", ["description"])).toEqual({ ok: false, reason: "frozen" });
  });
});
