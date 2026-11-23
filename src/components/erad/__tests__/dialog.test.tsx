// EDS dialog: modal, the page behind is dimmed to 60%, focus can start on a chosen field.
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { Dialog } from "@/components/erad/dialog";

function WithField() {
  const field = useRef<HTMLInputElement>(null);
  return (
    <Dialog open onOpenChange={() => {}} title="Pick one" initialFocusRef={field}>
      <input ref={field} aria-label="Search" />
    </Dialog>
  );
}

describe("Dialog", () => {
  it("dims the page behind it by default, with the EDS 60% overlay", () => {
    render(<Dialog open onOpenChange={() => {}} title="Delete this?" />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.body.querySelector('[class~="bg-black/60"]')).not.toBeNull();
  });
  it("moves focus to the chosen field when it opens", async () => {
    render(<WithField />);
    await screen.findByRole("dialog");
    expect(document.activeElement).toBe(screen.getByLabelText("Search"));
  });
});
