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
  it("marks the error with a red icon and keeps the message in the text colour", () => {
    render(<TextField label="Password" error="That did not match." />);
    const desc = document.getElementById(
      screen.getByLabelText("Password").getAttribute("aria-describedby") ?? "",
    );
    expect(desc?.className).toContain("text-text-main");
    expect(desc?.className).not.toContain("text-border-error");
    expect(desc?.querySelector("[data-error-icon]")?.getAttribute("class")).toContain(
      "text-border-error",
    );
  });
});
