import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceTag } from "@/components/admin/source-tag";
describe("SourceTag", () => {
  it("should use gray tags only, so where a setting comes from never looks like a status", () => {
    render(
      <>
        {(["inherited", "changed", "locked", "own"] as const).map((s) => (
          <SourceTag key={s} source={s} />
        ))}
      </>,
    );
    for (const t of ["Inherited", "Changed here", "Locked", "Added here"]) {
      const tag = screen.getByText(t).closest("span");
      expect(tag?.className).toContain("--tone:var(--border-item-idle)");
    }
    expect(screen.getByText("Locked").closest("span")?.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Inherited").closest("span")?.querySelector("svg")).toBeNull();
  });
});
