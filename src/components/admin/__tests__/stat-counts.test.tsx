// Counts for the group show the same type names as everywhere else, never the internal code.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatCounts } from "@/components/admin/stat-counts";

describe("StatCounts", () => {
  it("names document types as people read them", () => {
    render(
      <StatCounts
        rows={[
          {
            documentType: "orderAttachment",
            status: "draft",
            pipelineState: "ready",
            legalHold: false,
            n: 2,
          },
          {
            documentType: "regulatoryFiling",
            status: "draft",
            pipelineState: "ready",
            legalHold: false,
            n: 1,
          },
        ]}
      />,
    );
    expect(screen.getByText("Order attachment")).toBeTruthy();
    expect(screen.getByText("Regulatory filing")).toBeTruthy();
    expect(screen.queryByText("orderAttachment")).toBeNull();
  });
});
describe("StatCounts processing", () => {
  it("says No file yet instead of a stuck Uploading", () => {
    render(
      <StatCounts
        rows={[
          {
            documentType: "quote",
            status: "draft",
            pipelineState: "uploading",
            legalHold: false,
            n: 10,
          },
        ]}
      />,
    );
    expect(screen.getByText("No file yet")).toBeTruthy();
    expect(screen.queryByText("Uploading")).toBeNull();
  });
});
