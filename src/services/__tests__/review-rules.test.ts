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
