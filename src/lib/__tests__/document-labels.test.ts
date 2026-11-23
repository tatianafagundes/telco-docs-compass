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
import { storedPipelineLabel } from "@/lib/document-labels";
describe("storedPipelineLabel", () => {
  it("says a file is missing, not that it is uploading, when nothing is uploading it", () => {
    // Documents registered through the API with only a content hash stay in this state until a file arrives.
    expect(storedPipelineLabel("uploading", false)).toBe("No file yet");
  });
  it("keeps Uploading while this page is sending the file", () => {
    expect(storedPipelineLabel("uploading", true)).toBe("Uploading");
  });
  it("leaves the other states as they are", () => {
    expect(storedPipelineLabel("scanning", false)).toBe("Checking for threats");
    expect(storedPipelineLabel("failed", false)).toBe("Couldn't read");
  });
});
