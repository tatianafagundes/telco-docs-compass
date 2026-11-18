import { describe, expect, it } from "vitest";
import { activityDetail, typeLabel } from "@/lib/document-labels";

describe("typeLabel", () => {
  it("should show a plain name for a known type code", () => {
    expect(typeLabel("orderAttachment")).toBe("Order attachment");
  });
  it("should make an unknown code readable", () => {
    expect(typeLabel("powerOfAttorney")).toBe("Power of attorney");
  });
});

describe("activityDetail", () => {
  it("should describe a removed share in plain words", () => {
    expect(activityDetail("revoked user")).toBe("access removed");
  });
  it("should describe a given share with its level", () => {
    expect(activityDetail("granted view to user")).toBe("access given (can view)");
  });
});
import { recordKindLabel, recordLabel } from "@/lib/document-labels";
describe("recordKindLabel", () => {
  it.each([
    ["ProductOrder", "Order"],
    ["Quote", "Quote"],
    ["Account", "Account"],
    ["BillingAccount", "Billing account"],
    ["TroubleTicket", "Trouble ticket"],
    ["FooBar", "Foo bar"],
  ])("should name %s as %s", (code, label) => {
    expect(recordKindLabel(code)).toBe(label);
  });
  it("should put the kind before the name", () => {
    expect(recordLabel("ProductOrder", "O-7731 Fibre upgrade")).toBe(
      "Order · O-7731 Fibre upgrade",
    );
  });
});
