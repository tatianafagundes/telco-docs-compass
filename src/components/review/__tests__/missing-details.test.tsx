// Required details nobody could read: the reviewer enters them, and sees why approval waits.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// vi.mock is hoisted, so the stand-in class is created inside it (and read back from the mock).
vi.mock("@/services/api", () => {
  class SeamFailure extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { SeamFailure, api: {} };
});

import { MissingDetails } from "@/components/review/missing-details";
import { SeamFailure } from "@/services/api";

// The mock above takes a plain code; the real class takes an error object.
const failure = (code: string) => new (SeamFailure as unknown as new (code: string) => Error)(code);

describe("MissingDetails", () => {
  it("shows nothing when no required detail is missing", () => {
    const { container } = render(<MissingDetails names={[]} canEnter onSave={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
  it("saves a detail with its name and the value without surrounding spaces", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MissingDetails names={["counterparty", "contractNumber"]} canEnter onSave={onSave} />);
    expect(screen.getByText(/Approval waits until they are entered/)).toBeTruthy();
    const [first] = screen.getAllByRole("textbox");
    fireEvent.change(first as HTMLElement, { target: { value: "  Acme AB  " } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0] as HTMLElement);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("counterparty", "Acme AB"));
  });
  it("does not save an empty value, and says why", async () => {
    const onSave = vi.fn();
    render(<MissingDetails names={["counterparty"]} canEnter onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getAllByText("Enter a value.").length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });
  it("shows the server's plain reason when saving fails, and keeps what was typed", async () => {
    const onSave = vi.fn().mockRejectedValue(failure("extraction.detail.exists"));
    render(<MissingDetails names={["counterparty"]} canEnter onSave={onSave} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Acme AB" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findAllByText(/already read from the file/)).length).toBeGreaterThan(0);
    expect((input as HTMLInputElement).value).toBe("Acme AB");
  });
  it("only names the missing details for someone who may read but not review", () => {
    render(<MissingDetails names={["counterparty"]} canEnter={false} onSave={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/Approval waits until a reviewer enters: /)).toBeTruthy();
  });
});
