import { describe, expect, it } from "vitest";
import {
  BULK_LEASE_SECONDS,
  bulkSkipReason,
  leaseExpired,
  bulkSummary,
  countLabel,
  hasAnyFilter,
  looksLikeIdentifier,
  normaliseFilters,
  splitPage,
} from "@/services/search-rules";

const row = (i: number) => ({
  id: `id-${i}`,
  name: `Doc ${i}`,
  updated_at: `2026-01-${String(30 - i).padStart(2, "0")}`,
  expiry_date: null,
});

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
    expect(
      normaliseFilters({
        q: "  ",
        types: [],
        sort: "updated",
        statuses: ["draft", "approved", "draft"],
      }),
    ).toEqual({ statuses: ["approved", "draft"] });
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
  const doc = {
    status: "in_review" as const,
    legalHold: false,
    sensitivity: "internal",
    pendingRequired: 0,
    isOwn: false,
  };
  it("should skip approval of a document the same person added (four-eyes)", () => {
    expect(
      bulkSkipReason("manager", "transition", { to: "approved" }, { ...doc, isOwn: true }),
    ).toBe("ownDocument");
    expect(
      bulkSkipReason("manager", "transition", { to: "approved" }, { ...doc, isOwn: false }),
    ).toBeNull();
  });
  it("should skip holds when the role is below manager", () => {
    expect(bulkSkipReason("contributor", "placeHold", {}, doc)).toBe("noPermission");
    expect(bulkSkipReason("manager", "placeHold", {}, doc)).toBeNull();
  });
  it("should skip approval while required details are pending", () => {
    expect(
      bulkSkipReason("reviewer", "transition", { to: "approved" }, { ...doc, pendingRequired: 2 }),
    ).toBe("detailsPending");
  });
  it("should skip a status that is not the next step", () => {
    expect(bulkSkipReason("manager", "transition", { to: "effective" }, doc)).toBe("notAllowed");
  });
  it("should skip sensitivity changes on frozen documents", () => {
    expect(
      bulkSkipReason(
        "manager",
        "setSensitivity",
        { sensitivity: "restricted" },
        { ...doc, status: "archived" },
      ),
    ).toBe("frozen");
  });
  it("should report missing documents", () => {
    expect(bulkSkipReason("manager", "releaseHold", {}, null)).toBe("notFound");
  });
});

describe("bulkSummary", () => {
  it("should list each skip reason with its count", () => {
    expect(bulkSummary(3, 1, { noPermission: 2 })).toBe(
      "1 of 3 changed · 2 skipped because your role can't make this change",
    );
  });
});

describe("leaseExpired", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
  it("is false while the holder is within its time", () => {
    expect(leaseExpired(ago(BULK_LEASE_SECONDS - 1), now)).toBe(false);
  });
  it("is true once the lease is older than the limit", () => {
    expect(leaseExpired(ago(BULK_LEASE_SECONDS + 1), now)).toBe(true);
  });
  it("is true when there is no usable timestamp (a holder we cannot vouch for)", () => {
    expect(leaseExpired(undefined, now)).toBe(true);
    expect(leaseExpired("not a date", now)).toBe(true);
  });
});
