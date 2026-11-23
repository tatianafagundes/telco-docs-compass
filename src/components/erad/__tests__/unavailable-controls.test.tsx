// Unavailable controls stay focusable (their reason is shown nearby) but must look unavailable.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "@/components/erad/checkbox";
import { Select } from "@/components/erad/select";
describe("unavailable controls", () => {
  it("should mark an unavailable select and keep it closed", () => {
    render(
      <Select
        label="Retention policy"
        unavailable
        value="a"
        groups={[{ options: [{ value: "a", label: "Seven years" }] }]}
      />,
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    expect(trigger.className).toContain("aria-disabled:bg-input-disabled");
    trigger.click();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("should style an aria-disabled checkbox as unavailable", () => {
    render(<Checkbox label="Review required" aria-disabled checked />);
    expect(screen.getByRole("checkbox").className).toContain("aria-disabled:bg-input-disabled");
  });
});
