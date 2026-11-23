import { render, screen } from "@testing-library/react";
import { Lock } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Tag } from "@/components/erad/tag";
import { tagIcon } from "@/components/erad/tag-icon";
import { Banner } from "@/components/erad/banner";
const svgIn = (text: string) =>
  screen.getByText(text).closest("span")?.querySelector("svg") ?? null;
describe("Tag (EDS rules)", () => {
  it("should show no icon on a coloured tag, large or small", () => {
    render(
      <>
        <Tag tone="cleared">Approved</Tag>
        <Tag tone="purple">Added here</Tag>
        <Tag tone="warning" small>
          In review
        </Tag>
      </>,
    );
    expect(svgIn("Approved")).toBeNull();
    expect(svgIn("Added here")).toBeNull();
    expect(svgIn("In review")).toBeNull();
  });
  it("should let a default gray tag carry an icon, on large tags only", () => {
    const lock = <Lock aria-hidden="true" />;
    expect(tagIcon({ icon: lock })).toBe(lock);
    expect(tagIcon({ icon: lock, small: true })).toBeNull();
  });
  it("should show the severity icon only when asked, and never the purple AI sparkle", () => {
    expect(tagIcon({ tone: "critical" })).toBeNull();
    expect(tagIcon({ tone: "critical", severity: true })).not.toBeNull();
    expect(tagIcon({ tone: "purple", severity: true })).toBeNull();
  });
  it("should give an error banner the severity icon and a read-only banner a gray tag", () => {
    render(
      <>
        <Banner tone="critical" status="Not saved">
          x
        </Banner>
        <Banner icon={<Lock aria-hidden="true" />} status="Read-only">
          y
        </Banner>
        <Banner tone="indeterminate" status="2 to check">
          z
        </Banner>
      </>,
    );
    expect(svgIn("Not saved")).not.toBeNull();
    expect(svgIn("Read-only")).not.toBeNull();
    expect(svgIn("2 to check")).toBeNull();
  });
});
