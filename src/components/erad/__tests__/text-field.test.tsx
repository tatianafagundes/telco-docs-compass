// A field error must reach a screen reader when it appears, not only when the field is focused.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextField } from "@/components/erad/text-field";

describe("TextField error", () => {
  it("is announced as an alert when it appears, and describes the field", () => {
    const { rerender } = render(<TextField label="Password" helper="At least 8 characters" />);
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(
      <TextField label="Password" helper="At least 8 characters" error="That did not match." />,
    );
    expect(screen.getByRole("alert").textContent).toBe("That did not match.");
    const input = screen.getByLabelText("Password");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe("That did not match.");
  });
  it("shows the helper, and no alert, when there is no error", () => {
    render(<TextField label="Email" helper="Your work address" />);
    expect(screen.getByText("Your work address")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
