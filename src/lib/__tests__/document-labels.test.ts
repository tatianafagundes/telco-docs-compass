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
