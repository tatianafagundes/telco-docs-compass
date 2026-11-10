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
