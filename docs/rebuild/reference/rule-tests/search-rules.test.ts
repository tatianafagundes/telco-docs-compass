import { describe, expect, it } from "vitest";
import { bulkSkipReason, bulkSummary, countLabel, hasAnyFilter, looksLikeIdentifier, normaliseFilters, splitPage } from "@/services/search-rules";

const row = (i: number) => ({ id: `id-${i}`, name: `Doc ${i}`, updated_at: `2026-01-${String(30 - i).padStart(2, "0")}`, expiry_date: null });

describe("splitPage", () => {
  it("should return a cursor from the last shown row when one extra row came back", () => {
    const rows = Array.from({ length: 51 }, (_, i) => row(i));
    const p = splitPage(rows, "updated", 50);
    expect(p.items).toHaveLength(50);
    expect(p.next).toEqual({ v: rows[49]?.updated_at, id: "id-49" });
  });
  it("should return no cursor on the last page", () => {
    expect(splitPage([row(1)], "name", 50).next).toBeNull();
  });
  it("should use the name for the name sort", () => {
    expect(splitPage([row(1), row(2)], "name", 1).next).toEqual({ v: "Doc 1", id: "id-1" });
  });
});

describe("countLabel", () => {
  it("should cap at 10,000", () => {
    expect(countLabel(10_001)).toBe("More than 10,000 documents");
    expect(countLabel(10_000)).toBe("10,000 documents");
    expect(countLabel(1)).toBe("1 document");
  });
});

describe("normaliseFilters", () => {
  it("should drop empty values and the default sort so equal searches share a key", () => {
    expect(normaliseFilters({ q: "  ", types: [], sort: "updated", statuses: ["draft", "approved", "draft"] })).toEqual({ statuses: ["approved", "draft"] });
    expect(hasAnyFilter({ sort: "name" })).toBe(false);
  });
});

describe("looksLikeIdentifier", () => {
  it("should treat order and quote numbers as identifiers and words as text", () => {
    expect(looksLikeIdentifier("O-7731")).toBe(true);
    expect(looksLikeIdentifier("Q-2026-0412")).toBe(true);
    expect(looksLikeIdentifier("master agreement")).toBe(false);
    expect(looksLikeIdentifier("agreement")).toBe(false);
  });
});

describe("bulkSkipReason", () => {
  const doc = { status: "in_review" as const, legalHold: false, sensitivity: "internal", pendingRequired: 0 };
  it("should skip holds when the role is below manager", () => {
    expect(bulkSkipReason("contributor", "placeHold", {}, doc)).toBe("noPermission");
    expect(bulkSkipReason("manager", "placeHold", {}, doc)).toBeNull();
  });
  it("should skip approval while required details are pending", () => {
    expect(bulkSkipReason("reviewer", "transition", { to: "approved" }, { ...doc, pendingRequired: 2 })).toBe("detailsPending");
  });
  it("should skip a status that is not the next step", () => {
    expect(bulkSkipReason("manager", "transition", { to: "effective" }, doc)).toBe("notAllowed");
  });
  it("should skip sensitivity changes on frozen documents", () => {
    expect(bulkSkipReason("manager", "setSensitivity", { sensitivity: "restricted" }, { ...doc, status: "archived" })).toBe("frozen");
  });
  it("should report missing documents", () => {
    expect(bulkSkipReason("manager", "releaseHold", {}, null)).toBe("notFound");
  });
});

describe("bulkSummary", () => {
  it("should list each skip reason with its count", () => {
    expect(bulkSummary(3, 1, { noPermission: 2 })).toBe("1 of 3 changed · 2 skipped because your role can't make this change");
  });
});

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
import { BULK_BATCH, BULK_LIMIT, COUNT_CAP, cursorFor, PAGE_SIZE, searchFiltersSchema, SKIP_LABEL, SORTS } from "@/services/search-rules";

describe("BR-100 filter limits", () => {
  const ok = (f: unknown) => searchFiltersSchema.safeParse(f).success;
  it("BR-100 q ≤200, types ≤30, statuses ≤7, sensitivity ≤4, entityTypes ≤10", () => {
    expect(ok({ q: "x".repeat(200) })).toBe(true);
    expect(ok({ q: "x".repeat(201) })).toBe(false);
    expect(ok({ types: Array.from({ length: 30 }, (_, i) => `t${i}`) })).toBe(true);
    expect(ok({ types: Array.from({ length: 31 }, (_, i) => `t${i}`) })).toBe(false);
    expect(ok({ statuses: ["draft", "in_review", "approved", "effective", "superseded", "expired", "archived"] })).toBe(true);
    expect(ok({ statuses: Array.from({ length: 8 }, () => "draft") })).toBe(false);
    expect(ok({ statuses: ["deleted"] })).toBe(false);
    expect(ok({ sensitivity: ["public", "internal", "confidential", "restricted"] })).toBe(true);
    expect(ok({ sensitivity: Array.from({ length: 5 }, () => "public") })).toBe(false);
    expect(ok({ entityTypes: Array.from({ length: 10 }, (_, i) => `e${i}`) })).toBe(true);
    expect(ok({ entityTypes: Array.from({ length: 11 }, (_, i) => `e${i}`) })).toBe(false);
  });
  it("BR-100 dates, booleans and sort keys", () => {
    expect(ok({ changedAfter: "2026-11-10", expiringBefore: "2026-12-31", hold: true, review: false, entityId: "ord-se-7731" })).toBe(true);
    expect(ok({ changedAfter: "soon" })).toBe(false);
    expect(ok({ expiringBefore: "2026-12-31T00:00:00Z" })).toBe(false);
    expect(SORTS).toEqual(["updated", "name", "expiry"]);
    expect(ok({ sort: "expiry" })).toBe(true);
    expect(ok({ sort: "size" })).toBe(false);
  });
});

describe("BR-101/BR-102 normalisation and paging", () => {
  it("BR-101 q is trimmed and kept, arrays de-duplicated and sorted, flags kept only when true", () => {
    expect(normaliseFilters({ q: "  O-7731 ", types: ["b", "a", "b"], hold: false, review: true, sort: "name" })).toEqual({ q: "O-7731", types: ["a", "b"], review: true, sort: "name" });
  });
  it("BR-102 page size 50, cursor v is updated_at, name or expiry_date ('' when null)", () => {
    expect(PAGE_SIZE).toBe(50);
    const r = { id: "d1", name: "Doc", updated_at: "2026-01-01T00:00:00Z", expiry_date: null };
    expect(cursorFor("updated", r)).toEqual({ v: "2026-01-01T00:00:00Z", id: "d1" });
    expect(cursorFor("name", r)).toEqual({ v: "Doc", id: "d1" });
    expect(cursorFor("expiry", r)).toEqual({ v: "", id: "d1" });
    expect(cursorFor("expiry", { ...r, expiry_date: "2027-01-01" })).toEqual({ v: "2027-01-01", id: "d1" });
    const rows = Array.from({ length: 51 }, (_, i) => row(i));
    expect(splitPage(rows, "updated").items).toHaveLength(50);
    expect(splitPage(rows.slice(0, 50), "updated").next).toBeNull();
  });
});

describe("BR-103/BR-104 labels and identifiers", () => {
  it("BR-103 count cap constant and en-GB grouping", () => {
    expect(COUNT_CAP).toBe(10_000);
    expect(countLabel(1234)).toBe("1,234 documents");
    expect(countLabel(0)).toBe("0 documents");
  });
  it("BR-104 identifier: 3–64 characters, no spaces, contains a digit, allowed characters, no leading punctuation", () => {
    expect(looksLikeIdentifier("A1")).toBe(false);
    expect(looksLikeIdentifier("A12")).toBe(true);
    expect(looksLikeIdentifier(`A${"1".repeat(63)}`)).toBe(true);
    expect(looksLikeIdentifier(`A${"1".repeat(64)}`)).toBe(false);
    expect(looksLikeIdentifier("abc")).toBe(false);
    expect(looksLikeIdentifier("O 7731")).toBe(false);
    expect(looksLikeIdentifier("-7731")).toBe(false);
    expect(looksLikeIdentifier("Q/2026.0412_v2")).toBe(true);
    expect(looksLikeIdentifier("Q#2026")).toBe(false);
    expect(looksLikeIdentifier("  O-7731  ")).toBe(true);
  });
});

describe("BR-105/BR-106/BR-107 bulk", () => {
  const doc = { status: "in_review" as const, legalHold: false, sensitivity: "internal", pendingRequired: 0 };
  it("BR-105 bulk limit 10,000 in batches of 200", () => {
    expect(BULK_LIMIT).toBe(10_000);
    expect(BULK_BATCH).toBe(200);
  });
  it("BR-106 skip labels are exact", () => {
    expect(SKIP_LABEL).toEqual({
      noPermission: "your role can't make this change",
      frozen: "the document can no longer be changed",
      notAllowed: "it isn't the next step on its status path",
      detailsPending: "required details still need checking",
      notFound: "it was removed or is no longer visible",
      unchanged: "it already had this value",
    });
  });
  it("BR-106 unchanged: a hold already on or off, the same sensitivity, the same status", () => {
    expect(bulkSkipReason("manager", "placeHold", {}, { ...doc, legalHold: true })).toBe("unchanged");
    expect(bulkSkipReason("manager", "releaseHold", {}, doc)).toBe("unchanged");
    expect(bulkSkipReason("contributor", "setSensitivity", { sensitivity: "internal" }, doc)).toBe("unchanged");
    expect(bulkSkipReason("contributor", "setSensitivity", { sensitivity: "restricted" }, doc)).toBeNull();
    expect(bulkSkipReason("viewer", "setSensitivity", { sensitivity: "restricted" }, doc)).toBe("noPermission");
    expect(bulkSkipReason("manager", "transition", { to: "in_review" }, doc)).toBe("unchanged");
    expect(bulkSkipReason("manager", "transition", {}, doc)).toBe("notAllowed");
    expect(bulkSkipReason("contributor", "transition", { to: "approved" }, doc)).toBe("noPermission");
    expect(bulkSkipReason("reviewer", "transition", { to: "approved" }, doc)).toBeNull();
  });
  it("BR-107 summary lists every reason with en-GB grouping", () => {
    expect(bulkSummary(10_000, 1_200, { frozen: 8_000, unchanged: 800, notFound: 0 })).toBe(
      "1,200 of 10,000 changed · 8,000 skipped because the document can no longer be changed · 800 skipped because it already had this value",
    );
    expect(bulkSummary(3, 3, {})).toBe("3 of 3 changed");
  });
});
