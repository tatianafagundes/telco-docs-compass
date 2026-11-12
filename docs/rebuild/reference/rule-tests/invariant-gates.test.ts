/**
 * INVARIANT GATES - regression gates for the decisions the product owner froze in
 * docs/rebuild/17-kiro-steering/invariants.md. Every expected value below is copied from
 * docs/rebuild/03-business-rules.md (the spec), never computed with the code under test.
 *
 * Why this file exists: the prototype is the behaviour ORACLE of the Java/Angular rebuild
 * ("when the spec and the app disagree, the app's tests decide"). A test that restates what the
 * code does today would let a change to an invariant pass silently. So each gate states the rule in
 * the owner's words, uses literal numbers and strings from the spec, and covers the adversarial case
 * that a lazy implementation gets wrong (own document + admin role, required field with high
 * confidence still pending, retain_until == today, Retry-After above the cap, ...).
 *
 * Only pure modules are covered (no I/O): document-rules, document-actions, review-flow-rules,
 * review-rules, rate-limit-rules, event-delivery-rules, tmf667-mapper. Server-side enforcement
 * (document-write.functions.ts, SQL) is out of reach of a pure gate.
 *
 * `it.fails` marks a SPEC vs SOURCE divergence: the spec text is asserted, the source differs, and the
 * owner decides which side moves. When the owner decides, change the source (then turn it.fails into
 * it) or change the spec text here, in the same commit.
 *
 * If a gate goes red: either the change was intentional - and then update the spec and the value
 * here IN THE SAME COMMIT, so the movement shows in the diff - or it was not, which is the case
 * this file exists to catch.
 *
 * Usage: cd /Users/earatat/telco-docs-compass && bun run test src/services/__tests__/invariant-gates.test.ts
 */
import { describe, expect, it } from "vitest";
import type { DocStatus } from "@/schemas/document";
import { deleteBlocker, isFrozen, isTransitionAllowed, pendingRequiredDetails, type AppRole } from "@/services/document-rules";
import { deleteState, purgeState, sendBackState } from "@/services/document-actions";
import { AUTHOR_APPROVE_REASON, footerAction, isOwnDocument } from "@/services/review-flow-rules";
import { approveGate } from "@/services/review-rules";
import { decideRate } from "@/services/rate-limit-rules";
import { BACKOFF_SECONDS, MAX_ATTEMPTS, outcomeAfter, parseRetryAfter } from "@/services/event-delivery-rules";
import { targetForTmfStatus, toTmfStatus } from "@/services/tmf667-mapper";

const ALL_STATUSES: DocStatus[] = ["draft", "in_review", "approved", "effective", "superseded", "expired", "archived"];

// ---------------------------------------------------------------------------------------------
// Invariant 5 / BR-022 / BR-025: four-eyes.
// Spec: "Someone other than the person who added it needs to approve it." Null creator is exempt.
// Adversarial: the creator is a tenant_admin (rank 4) - a high role must NOT buy an exemption.
// Adversarial: a caller below reviewer fails on ROLE, not on four-eyes (BR-025 order: role, gate, four-eyes).
// ---------------------------------------------------------------------------------------------
describe("gate invariant 5: four-eyes", () => {
  const base = { status: "in_review" as DocStatus, toCheck: 0, gate: { pending: 0 } };

  it("gate invariant 5 / BR-022: the reason text is the exact spec sentence", () => {
    expect(AUTHOR_APPROVE_REASON).toBe("Someone other than the person who added it needs to approve it.");
  });

  it("gate invariant 5 / BR-022: a null or empty creator is exempt, a different creator is not own", () => {
    expect(isOwnDocument(null, "user-1")).toBe(false);
    expect(isOwnDocument(undefined, "user-1")).toBe(false);
    expect(isOwnDocument("", "")).toBe(false); // empty creator and empty (signed-out) caller must not match
    expect(isOwnDocument("user-2", "user-1")).toBe(false);
    expect(isOwnDocument("user-1", "user-1")).toBe(true);
  });

  it.each<AppRole>(["reviewer", "manager", "tenant_admin", "master_admin"])(
    "gate invariant 5 / BR-022: %s who added the document cannot approve it, whatever the role",
    (role) => {
      const a = footerAction({ role, ...base, own: true });
      expect(a).toMatchObject({ kind: "transition", label: "Approve document", available: false, reason: "Someone other than the person who added it needs to approve it." });
    },
  );

  it("gate invariant 5 / BR-022: another reviewer, or a creator-less document, can approve", () => {
    expect(footerAction({ role: "reviewer", ...base, own: isOwnDocument("user-2", "user-1") })).toMatchObject({ available: true });
    expect(footerAction({ role: "tenant_admin", ...base, own: isOwnDocument(null, "user-1") })).toMatchObject({ available: true });
  });

  it("gate invariant 5 / BR-025: below reviewer the refusal is the ROLE reason, even for the author", () => {
    for (const own of [false, true]) {
      for (const role of ["viewer", "contributor"] as AppRole[]) {
        const a = footerAction({ role, ...base, own });
        expect(a).toMatchObject({ available: false, reason: "Only reviewers and managers can do this." });
      }
    }
  });

  it("gate invariant 5 / BR-025: the pending-details gate is reported before four-eyes", () => {
    const a = footerAction({ role: "tenant_admin", status: "in_review", toCheck: 0, gate: { pending: 1, reason: "1 required detail needs checking" }, own: true });
    expect(a).toMatchObject({ available: false, reason: "1 required detail needs checking" });
  });
});

// ---------------------------------------------------------------------------------------------
// Invariant 6 / BR-020, BR-021, BR-023: no auto-acceptance.
// Spec: pending = required AND extractable characteristics lacking an accepted or edited field.
// Adversarial: a required field read with HIGH confidence is still pending until a person confirms it.
// Rejected ("Not in this document") is not a confirmation either.
// ---------------------------------------------------------------------------------------------
describe("gate invariant 6: no auto-acceptance", () => {
  const spec = [
    { name: "contractNumber", required: true, extractable: true },
    { name: "counterparty", required: true, extractable: true },
    { name: "endDate", required: true, extractable: true },
    { name: "notes", required: false, extractable: true },
    { name: "signedBy", required: true, extractable: false },
  ];

  it("gate invariant 6 / BR-021: singular text for one, plural text for N", () => {
    const one = approveGate(spec, [
      { name: "contractNumber", status: "accepted" },
      { name: "counterparty", status: "edited" },
      { name: "endDate", status: "pending" },
    ]);
    expect(one).toEqual({ pending: 1, reason: "1 required detail needs checking" });
    const three = approveGate(spec, []);
    expect(three).toEqual({ pending: 3, reason: "3 required details need checking" });
  });

  it("gate invariant 6 / BR-020: detail is the count, and no reason once all three are accepted or edited", () => {
    const done = approveGate(spec, [
      { name: "contractNumber", status: "accepted" },
      { name: "counterparty", status: "edited" },
      { name: "endDate", status: "accepted" },
    ]);
    expect(done.pending).toBe(0);
    expect(done.reason).toBeUndefined();
  });

  it("gate invariant 6 / BR-023: a required field with high confidence and pending status still blocks approval", () => {
    // Fields carry confidence as the extractor stores them; approval must not look at it.
    const readWithHighConfidence = { name: "contractNumber", status: "pending" as const, confidence: 0.999, band: "high" as const };
    const fields = [
      readWithHighConfidence,
      { name: "counterparty", status: "accepted" as const, confidence: 0.2, band: "low" as const },
      { name: "endDate", status: "accepted" as const, confidence: 0.2, band: "low" as const },
    ];
    expect(pendingRequiredDetails(spec, fields)).toEqual(["contractNumber"]);
    expect(approveGate(spec, fields).reason).toBe("1 required detail needs checking");
  });

  it("gate invariant 6 / BR-020: a rejected required field is not a confirmation", () => {
    const fields = [
      { name: "contractNumber", status: "rejected" as const },
      { name: "counterparty", status: "accepted" as const },
      { name: "endDate", status: "accepted" as const },
    ];
    expect(approveGate(spec, fields).pending).toBe(1);
  });

  it("gate invariant 6 / BR-020: optional or non-extractable characteristics never block", () => {
    const fields = [
      { name: "contractNumber", status: "accepted" as const },
      { name: "counterparty", status: "accepted" as const },
      { name: "endDate", status: "accepted" as const },
      { name: "notes", status: "pending" as const },
      { name: "signedBy", status: "pending" as const },
    ];
    expect(approveGate(spec, fields).pending).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Invariant 7 / BR-010, BR-011, BR-013: forward-only status path.
// Spec table, written out literally. Every one of the 7x7 pairs is checked, so a "harmless" extra
// edge (in_review -> draft, effective -> approved, archived -> anything) turns this red.
// ---------------------------------------------------------------------------------------------
describe("gate invariant 7: status path is forward-only", () => {
  const SPEC_ALLOWED: Record<DocStatus, DocStatus[]> = {
    draft: ["in_review"],
    in_review: ["approved"],
    approved: ["effective"],
    effective: ["superseded", "expired"],
    superseded: ["archived"],
    expired: ["archived"],
    archived: [],
  };

  it("gate invariant 7 / BR-010: all 49 from/to pairs match the spec table exactly", () => {
    const wrong: string[] = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = SPEC_ALLOWED[from].includes(to);
        if (isTransitionAllowed(from, to) !== expected) wrong.push(`${from}->${to} should be ${expected ? "allowed" : "refused"}`);
      }
    }
    expect(wrong, "BR-010 table differs from the code").toEqual([]);
  });

  it("gate invariant 7 / BR-010: archived has no next status", () => {
    for (const to of ALL_STATUSES) expect(isTransitionAllowed("archived", to)).toBe(false);
  });

  it("gate invariant 7 / BR-011: in_review to draft is refused as a transition; only send back (needs review) goes there", () => {
    expect(isTransitionAllowed("in_review", "draft")).toBe(false);
    expect(sendBackState("reviewer", "in_review")).toEqual({ available: true });
    expect(sendBackState("contributor", "in_review")).toEqual({ available: false, reason: "Only reviewers and managers can do this." });
    for (const s of ALL_STATUSES.filter((x) => x !== "in_review")) expect(sendBackState("tenant_admin", s)).toBeNull();
  });

  it("gate invariant 7 / BR-013: frozen statuses are exactly superseded, expired and archived", () => {
    expect(ALL_STATUSES.filter(isFrozen)).toEqual(["superseded", "expired", "archived"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Invariant 8 / BR-050, BR-051, BR-052: legal hold beats retention, retention beats the group floor.
// Soft delete refuses retain_until LATER than today (>); permanent deletion refuses retain_until
// today or later (>=). Adversarial: retain_until == today -> soft delete allowed, permanent blocked.
// ---------------------------------------------------------------------------------------------
describe("gate invariant 8: hold, retention, deletion", () => {
  const TODAY = "2026-11-12";
  const facts = { legalHold: false, holdReason: null, retainUntil: null, createdAt: "2020-01-01T00:00:00Z", minRetentionDays: null, today: TODAY };

  it("gate invariant 8 / BR-050: hold wins over retention and over the group floor, detail is the hold reason", () => {
    const e = deleteBlocker({ ...facts, legalHold: true, holdReason: "CASE-42", retainUntil: "2027-01-01", createdAt: "2026-11-11T00:00:00Z", minRetentionDays: 3650 });
    expect(e?.code).toBe("doc.delete.legalHold");
    expect(e?.customerFacing?.detail).toBe("CASE-42");
  });

  it("gate invariant 8 / BR-050: retention wins over the group floor, detail is the retain_until date", () => {
    // floor would be 2026-11-11 + 3650 days (a later date); the answer must still name retain_until.
    const e = deleteBlocker({ ...facts, retainUntil: "2026-12-01", createdAt: "2026-11-11T00:00:00Z", minRetentionDays: 3650 });
    expect(e?.code).toBe("doc.delete.retention");
    expect(e?.customerFacing?.detail).toBe("2026-12-01");
  });

  it("gate invariant 8 / BR-050: the group floor is created_at + minRetentionDays, later than today blocks, equal does not", () => {
    // created 2026-11-01 + 12 days = 2026-11-13 (hand calculated) > today: blocked with that date.
    const blocked = deleteBlocker({ ...facts, createdAt: "2026-11-01T10:00:00Z", minRetentionDays: 12 });
    expect(blocked?.code).toBe("doc.delete.retention");
    expect(blocked?.customerFacing?.detail).toBe("2026-11-13");
    // created 2026-11-01 + 11 days = 2026-11-12 = today: not later than today, so free.
    expect(deleteBlocker({ ...facts, createdAt: "2026-11-01T10:00:00Z", minRetentionDays: 11 })).toBeNull();
  });

  it("gate invariant 8 / BR-050: no hold, no date, no floor gives no blocker", () => {
    expect(deleteBlocker(facts)).toBeNull();
  });

  it("gate invariant 8 / BR-051: soft delete texts, and role is refused before hold", () => {
    expect(deleteState("manager", true, null, TODAY)).toEqual({ available: false, reason: "A legal hold keeps this document safe. Release the hold first." });
    expect(deleteState("manager", false, "2026-12-01", TODAY)).toEqual({ available: false, reason: "This document must be kept until 2026-12-01." });
    // below manager the role reason wins even when a hold exists
    expect(deleteState("reviewer", true, null, TODAY)).toEqual({ available: false, reason: "Only managers and administrators can do this." });
    expect(deleteState("manager", false, null, TODAY)).toEqual({ available: true });
  });

  it("gate invariant 8 / BR-051 vs BR-052: retain_until equal to today - soft delete allowed, permanent deletion blocked", () => {
    expect(deleteState("tenant_admin", false, TODAY, TODAY)).toEqual({ available: true });
    expect(deleteBlocker({ ...facts, retainUntil: TODAY })).toBeNull();
    expect(purgeState("tenant_admin", false, TODAY, TODAY)).toEqual({ available: false, reason: "This document must be kept until 2026-11-12." });
    // the day after, permanent deletion is free (and a day before today soft delete would be too)
    expect(purgeState("tenant_admin", false, "2026-11-11", TODAY)).toEqual({ available: true });
    expect(deleteState("tenant_admin", false, "2026-11-13", TODAY).available).toBe(false);
  });

  it("gate invariant 8 / BR-052: permanent deletion is for tenant_admin and master_admin only", () => {
    const text = "Only administrators can delete permanently.";
    for (const role of ["viewer", "contributor", "reviewer", "manager"] as AppRole[]) {
      expect(purgeState(role, false, null, TODAY)).toEqual({ available: false, reason: text });
    }
    expect(purgeState("tenant_admin", false, null, TODAY)).toEqual({ available: true });
    expect(purgeState("master_admin", false, null, TODAY)).toEqual({ available: true });
  });

  it("gate invariant 8 / BR-052: a hold blocks permanent deletion before retention, and after the role check", () => {
    const hold = "A legal hold blocks permanent deletion. Release the hold first.";
    expect(purgeState("tenant_admin", true, null, TODAY)).toEqual({ available: false, reason: hold });
    expect(purgeState("tenant_admin", true, "2027-01-01", TODAY)).toEqual({ available: false, reason: hold });
    // a manager with a hold is told about the role, not the hold
    expect(purgeState("manager", true, null, TODAY)).toEqual({ available: false, reason: "Only administrators can delete permanently." });
  });
});

// ---------------------------------------------------------------------------------------------
// Invariant 11 / BR-112, BR-115: per-system limits.
// Spec: allowed when hits (including this request) <= limit; reset = max(1, 60 - current UTC second).
// Adversarial: the request that reaches the limit is allowed, the next one is refused.
// Isolation between systems (BR-115) lives in the counter store (SQL), not in a pure module: see report.
// ---------------------------------------------------------------------------------------------
describe("gate invariant 11: rate limit window", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 9, 30, s));

  it("gate invariant 11 / BR-112: with limit 5, requests 1 to 5 pass and the sixth is refused", () => {
    const results = [1, 2, 3, 4, 5, 6].map((hits) => decideRate(hits, 5, at(10)).allowed);
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(decideRate(5, 5, at(10)).remaining).toBe(0);
    expect(decideRate(6, 5, at(10)).remaining).toBe(0);
  });

  it("gate invariant 11 / BR-112: reset is 60 minus the UTC second, never below 1", () => {
    expect(decideRate(1, 5, at(0)).resetSeconds).toBe(60);
    expect(decideRate(1, 5, at(45)).resetSeconds).toBe(15);
    expect(decideRate(1, 5, at(59)).resetSeconds).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Invariant 10 / BR-121, BR-122: retry schedule.
// Spec: up to 6 attempts; backoff after failures 1-5 is 30, 120, 600, 1800, 7200 s; Retry-After is
// honoured up to 3600 s; wait = max(backoff, Retry-After); an invalid Retry-After is ignored.
// Adversarial: Retry-After above the cap (5000 -> 3600) must not shorten the 7200 s backoff, and a
// Retry-After that is neither seconds nor an HTTP date must not become a wait.
// ---------------------------------------------------------------------------------------------
describe("gate invariant 10: delivery retries", () => {
  const NOW = new Date("2026-11-12T09:30:00Z");

  it("gate invariant 10 / BR-121: six attempts, backoff 30/120/600/1800/7200, then give up", () => {
    expect(MAX_ATTEMPTS).toBe(6);
    expect([...BACKOFF_SECONDS]).toEqual([30, 120, 600, 1800, 7200]);
    const waits = [1, 2, 3, 4, 5].map((n) => outcomeAfter(n, 500, null));
    expect(waits).toEqual([
      { kind: "retry", waitSeconds: 30 },
      { kind: "retry", waitSeconds: 120 },
      { kind: "retry", waitSeconds: 600 },
      { kind: "retry", waitSeconds: 1800 },
      { kind: "retry", waitSeconds: 7200 },
    ]);
    expect(outcomeAfter(6, 500, null)).toEqual({ kind: "gaveUp" });
    expect(outcomeAfter(6, null, null)).toEqual({ kind: "gaveUp" }); // network failure counts too
  });

  it("gate invariant 10 / BR-120: any 2xx is delivered, even on the last attempt", () => {
    expect(outcomeAfter(1, 200, null)).toEqual({ kind: "delivered" });
    expect(outcomeAfter(6, 204, null)).toEqual({ kind: "delivered" });
    expect(outcomeAfter(1, 301, null)).toMatchObject({ kind: "retry" });
  });

  it("gate invariant 10 / BR-121: wait is max(backoff, Retry-After), Retry-After capped at 3600", () => {
    expect(outcomeAfter(1, 429, 100)).toEqual({ kind: "retry", waitSeconds: 100 }); // 100 > 30
    expect(outcomeAfter(2, 429, 10)).toEqual({ kind: "retry", waitSeconds: 120 }); // 10 < 120
    expect(outcomeAfter(1, 429, 3600)).toEqual({ kind: "retry", waitSeconds: 3600 }); // at the cap
    expect(outcomeAfter(1, 429, 5000)).toEqual({ kind: "retry", waitSeconds: 3600 }); // above the cap
    expect(outcomeAfter(5, 429, 5000)).toEqual({ kind: "retry", waitSeconds: 7200 }); // backoff 7200 > capped 3600
  });

  it("gate invariant 10 / BR-122: Retry-After in seconds or as an HTTP date; garbage is ignored", () => {
    expect(parseRetryAfter("120", NOW)).toBe(120);
    expect(parseRetryAfter("Thu, 12 Nov 2026 09:31:30 GMT", NOW)).toBe(90); // 1 min 30 s after NOW
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter("", NOW)).toBeNull();
    expect(parseRetryAfter("soon", NOW)).toBeNull();
    expect(outcomeAfter(1, 503, parseRetryAfter("soon", NOW))).toEqual({ kind: "retry", waitSeconds: 30 });
  });

  // SPEC vs SOURCE: spec says an invalid Retry-After (neither delta-seconds nor an HTTP date) is
  // ignored (null); source falls back to Date.parse(), which accepts "-2999" and "2999.5" as the
  // year 2999 and returns ~32.4 billion seconds, so the wait becomes the 3600 s cap. Owner's decision pending.
  // (Date.parse of non-ISO strings is engine-specific; this is what V8 / Node does.)
  it.fails("gate invariant 10 / BR-122: a negative or fractional number is not a valid Retry-After and is ignored", () => {
    expect(parseRetryAfter("-2999", NOW)).toBeNull();
    expect(parseRetryAfter("2999.5", NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// BR-130 / BR-131: TMF status mapping in both directions.
// Spec tables written out literally; "deleted" is outbound only, and unknown values are refused.
// Adversarial: the three closing internal states all show as "archived" outward, but a client can only
// PATCH "archived" to land on internal archived (never superseded/expired).
// ---------------------------------------------------------------------------------------------
describe("gate BR-130/131: TMF status mapping", () => {
  it("gate invariant 7 / BR-130: internal status to TMF status", () => {
    const spec: Record<DocStatus, string> = {
      draft: "created",
      in_review: "reviewed",
      approved: "approved",
      effective: "published",
      superseded: "archived",
      expired: "archived",
      archived: "archived",
    };
    for (const s of ALL_STATUSES) expect(toTmfStatus(s), s).toBe(spec[s]);
  });

  it("gate invariant 8 / BR-130: a deleted document is 'deleted' whatever its status", () => {
    for (const s of ALL_STATUSES) expect(toTmfStatus(s, true), s).toBe("deleted");
  });

  it("gate invariant 7 / BR-131: PATCH status target mapping", () => {
    expect(targetForTmfStatus("created")).toBe("draft");
    expect(targetForTmfStatus("reviewed")).toBe("in_review");
    expect(targetForTmfStatus("approved")).toBe("approved");
    expect(targetForTmfStatus("published")).toBe("effective");
    expect(targetForTmfStatus("archived")).toBe("archived");
  });

  it("gate invariant 7 / BR-131: any other value is refused (deleted, internal names, case variants, empty)", () => {
    for (const v of ["deleted", "draft", "in_review", "effective", "superseded", "expired", "Created", "ARCHIVED", " approved", "", "unknown"]) {
      expect(targetForTmfStatus(v), JSON.stringify(v)).toBeNull();
    }
  });
});
