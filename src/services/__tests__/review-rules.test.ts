import { describe, expect, it } from "vitest";
import {
  approveGate,
  bannerText,
  editedNote,
  fieldLabel,
  nextToCheck,
  reviewOrder,
  toCheckCount,
  whyCanISee,
  type AccessItem,
} from "@/services/review-rules";

const spec = [
  { name: "contractNumber", required: true, extractable: true },
  { name: "counterparty", required: true, extractable: true },
  { name: "endDate", required: true, extractable: true },
  { name: "renewalType", extractable: true },
];

describe("review rules", () => {
  it("should keep Approve unavailable while required details are not checked", () => {
    const g = approveGate(spec, [
      { name: "contractNumber", status: "accepted" },
      { name: "counterparty", status: "pending" },
      { name: "endDate", status: "rejected" },
    ]);
    expect(g).toEqual({ pending: 2, reason: "2 required details need checking" });
  });
  it("should allow Approve when required details are accepted or edited", () => {
    expect(approveGate(spec, [
      { name: "contractNumber", status: "accepted" },
      { name: "counterparty", status: "edited" },
      { name: "endDate", status: "accepted" },
      { name: "renewalType", status: "pending" },
    ]).pending).toBe(0);
  });
  it("should order Low before Medium before High", () => {
    const order = reviewOrder([
      { name: "a", band: "high" as const },
      { name: "b", band: "low" as const },
      { name: "c", band: "medium" as const },
    ]).map((f) => f.band);
    expect(order).toEqual(["low", "medium", "high"]);
  });
  it("should jump to the next unchecked field and wrap round", () => {
    const f = [{ status: "pending" as const }, { status: "accepted" as const }, { status: "pending" as const }];
    expect(nextToCheck(f, 0)).toBe(2);
    expect(nextToCheck(f, 2)).toBe(0);
    expect(nextToCheck(f, 0, -1)).toBe(2);
    expect(nextToCheck([{ status: "accepted" as const }], 0)).toBe(-1);
    expect(toCheckCount(f)).toBe(2);
  });
  it("should use plain labels, never codes", () => {
    expect(fieldLabel("counterparty")).toBe("Other party");
    expect(fieldLabel("siteAddress")).toBe("Site address");
  });
  it("should word the banner and the edited note as agreed", () => {
    expect(bannerText(3)).toBe("3 details read from this document need checking.");
    expect(editedNote({ status: "edited", band: "high", original_value: "Fjärrvärme Syd AS" })).toBe("Edited – read as High: Fjärrvärme Syd AS");
  });
});

describe("why can I see this", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const name = (id: string) => (id === "ord-se-7731" ? "Order O-7731" : id);
  const fmt = () => "30 Nov";
  it("should explain access through the record", () => {
    const items: AccessItem[] = [{ subject: { type: "user", id: "u1" }, level: "view", source: "inheritedFromEntity", viaEntity: { id: "ord-se-7731" } }];
    expect(whyCanISee(items, "u1", name, fmt, now)).toBe("You can see this because you can view Order O-7731.");
  });
  it("should explain a personal share with its end date", () => {
    const items: AccessItem[] = [{ subject: { type: "user", id: "u1" }, level: "view", source: "explicit", grantedBy: "SE Admin", expiresAt: "2026-11-30T00:00:00Z" }];
    expect(whyCanISee(items, "u1", name, fmt, now)).toBe("You can see this because SE Admin shared it with you until 30 Nov.");
  });
  it("should ignore an expired share", () => {
    const items: AccessItem[] = [{ subject: { type: "user", id: "u1" }, level: "view", source: "explicit", grantedBy: "SE Admin", expiresAt: "2026-11-01T00:00:00Z" }];
    expect(whyCanISee(items, "u1", name, fmt, now)).toBe("You can see this because your role covers every record in your organisation.");
  });
});

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
import { BAND_TAG, isExpired, PAGE_SIZE, pageOf, STATUS_WORD } from "@/services/review-rules";

describe("BR-021/BR-023 approval gate wording", () => {
  it("BR-021 gate reason: singular and plural", () => {
    expect(approveGate(spec, [{ name: "contractNumber", status: "accepted" }, { name: "counterparty", status: "accepted" }])).toEqual({ pending: 1, reason: "1 required detail needs checking" });
    expect(approveGate(spec, [])).toEqual({ pending: 3, reason: "3 required details need checking" });
  });
  it("BR-023 a pending detail stays pending whatever its confidence", () => {
    const fields = [
      { name: "contractNumber", status: "pending" as const, confidence: 0.99, band: "high" as const },
      { name: "counterparty", status: "accepted" as const },
      { name: "endDate", status: "accepted" as const },
    ];
    expect(approveGate(spec, fields)).toEqual({ pending: 1, reason: "1 required detail needs checking" });
    expect(toCheckCount(fields)).toBe(1);
  });
});

describe("BR-030/BR-031 words and bands", () => {
  it("BR-030 field status words", () => {
    expect(STATUS_WORD).toEqual({ pending: "Not checked yet", accepted: "Accepted", edited: "Edited", rejected: "Rejected" });
  });
  it("BR-031 confidence band labels", () => {
    expect(BAND_TAG.high.label).toBe("High confidence");
    expect(BAND_TAG.medium.label).toBe("Medium confidence");
    expect(BAND_TAG.low.label).toBe("Low confidence");
  });
});

describe("BR-032 risk order", () => {
  it("BR-032 unknown confidence comes first and ties sort by name", () => {
    const order = reviewOrder([
      { name: "b-high", band: "high" as const },
      { name: "z-none", band: null },
      { name: "a-high", band: "high" as const },
      { name: "m-low", band: "low" as const },
      { name: "a-none", band: null },
    ]).map((f) => f.name);
    expect(order).toEqual(["a-none", "z-none", "m-low", "a-high", "b-high"]);
  });
});

describe("BR-041/BR-042/BR-043 texts", () => {
  it("BR-041 edited note names the band and the original, and is absent otherwise", () => {
    expect(editedNote({ status: "edited", band: "low", original_value: "SE12" })).toBe("Edited – read as Low: SE12");
    expect(editedNote({ status: "accepted", band: "low", original_value: "SE12" })).toBeNull();
    expect(editedNote({ status: "edited", band: null, original_value: "SE12" })).toBeNull();
  });
  it("BR-042 banner: singular and plural", () => {
    expect(bannerText(1)).toBe("1 detail read from this document needs checking.");
    expect(bannerText(2)).toBe("2 details read from this document need checking.");
  });
  it("BR-043 unknown codes become sentence case and the raw code is never shown", () => {
    expect(fieldLabel("renewalTermMonths")).toBe("Renewal term (months)");
    expect(fieldLabel("installationSiteCode")).toBe("Installation site code");
    expect(fieldLabel("installationSiteCode")).not.toContain("installationSiteCode");
  });
});

describe("BR-092 why can I see this, remaining branches", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const name = (id: string) => (id === "ord-se-7731" ? "Order O-7731" : id);
  const fmt = () => "30 Nov";
  it("BR-092 edit access through the record says edit", () => {
    const items: AccessItem[] = [{ subject: { type: "user", id: "u1" }, level: "edit", source: "inheritedFromEntity", viaEntity: { id: "ord-se-7731" } }];
    expect(whyCanISee(items, "u1", name, fmt, now)).toBe("You can see this because you can edit Order O-7731.");
  });
  it("BR-092 a share without an end date, and one from an unknown person", () => {
    const items: AccessItem[] = [{ subject: { type: "user", id: "u1" }, level: "view", source: "explicit", grantedBy: "SE Admin" }];
    expect(whyCanISee(items, "u1", name, fmt, now)).toBe("You can see this because SE Admin shared it with you.");
    const anon: AccessItem[] = [{ subject: { type: "user", id: "u1" }, level: "view", source: "explicit" }];
    expect(whyCanISee(anon, "u1", name, fmt, now)).toBe("You can see this because someone in your organisation shared it with you.");
  });
  it("BR-092 other people's items and tenant grants do not explain my access", () => {
    const items: AccessItem[] = [
      { subject: { type: "user", id: "u2" }, level: "view", source: "explicit", grantedBy: "SE Admin" },
      { subject: { type: "tenant", id: "aurora-no" }, level: "view", source: "crossTenantGrant" },
    ];
    expect(whyCanISee(items, "u1", name, fmt, now)).toBe("You can see this because your role covers every record in your organisation.");
    expect(isExpired("2026-11-01T00:00:00Z", now)).toBe(true);
    expect(isExpired(undefined, now)).toBe(false);
  });
});

describe("BR-096 paging", () => {
  it("BR-096 activity and people lists use 20 rows per page", () => {
    expect(PAGE_SIZE).toBe(20);
    const list = Array.from({ length: 45 }, (_, i) => i);
    expect(pageOf(list, 0)).toHaveLength(20);
    expect(pageOf(list, 1)[0]).toBe(20);
    expect(pageOf(list, 2)).toEqual([40, 41, 42, 43, 44]);
  });
});
