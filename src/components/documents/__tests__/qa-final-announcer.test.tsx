// Final QA pass: the announcer (file-hooks R5.5): live regions that exist before they speak, each
// change once, staggered clean-up, strict-mode double effects, hostile names, unmount.
import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCEMENT_MS, ProcessingAnnouncer } from "@/components/documents/processing-announcer";
import type { PipelineState } from "@/schemas/document";

type Doc = { id: string; name: string; pipeline_state: PipelineState; pipeline_detail?: unknown };
const d = (id: string, state: PipelineState, name = `${id}.pdf`, detail?: unknown): Doc => ({
  id,
  name,
  pipeline_state: state,
  pipeline_detail: detail,
});
const polite = () => screen.getByRole("status");
const alert = () => screen.getByRole("alert");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the live regions", () => {
  it("both exist, empty, on the first render: a region added together with its text is not announced", () => {
    render(<ProcessingAnnouncer docs={[d("a", "scanning")]} />);
    expect(polite()).toHaveAttribute("aria-live", "polite");
    expect(polite()).toBeEmptyDOMElement();
    expect(alert()).toBeEmptyDOMElement();
  });

  it("an empty list renders both regions too", () => {
    render(<ProcessingAnnouncer docs={[]} />);
    expect(polite()).toBeEmptyDOMElement();
    expect(alert()).toBeEmptyDOMElement();
  });

  it("failures and blocked files go to the alert, everything else to the status", () => {
    const { rerender } = render(
      <ProcessingAnnouncer docs={[d("a", "scanning"), d("b", "scanning"), d("c", "scanning")]} />,
    );
    rerender(
      <ProcessingAnnouncer
        docs={[
          d("a", "ready"),
          d("b", "quarantined", "b.pdf", {
            mode: "external",
            by: "Acme AV",
            step: "scan",
            reason: "threat",
          }),
          d("c", "failed", "c.pdf", {
            mode: "external",
            by: "Acme AV",
            step: "scan",
            reason: "noResult",
          }),
        ]}
      />,
    );
    expect(polite()).toHaveTextContent("a.pdf: ready.");
    expect(polite().children).toHaveLength(1);
    expect(alert().children).toHaveLength(2);
    expect(alert()).toHaveTextContent(
      "b.pdf: blocked for safety. Acme AV found a possible threat in this file.",
    );
    expect(alert()).toHaveTextContent(
      "c.pdf: couldn't check. Acme AV didn't answer within 30 minutes.",
    );
  });
});

describe("once, and only once", () => {
  it("a new array with the same states says nothing", () => {
    const { rerender } = render(<ProcessingAnnouncer docs={[d("a", "scanning")]} />);
    for (let i = 0; i < 5; i++) rerender(<ProcessingAnnouncer docs={[d("a", "scanning")]} />);
    expect(polite()).toBeEmptyDOMElement();
  });

  it("a detail change with the same state (a new attempt, a new system) says nothing", () => {
    const { rerender } = render(
      <ProcessingAnnouncer
        docs={[d("a", "scanning", "a.pdf", { mode: "external", attempt: 1 })]}
      />,
    );
    rerender(
      <ProcessingAnnouncer
        docs={[d("a", "scanning", "a.pdf", { mode: "external", attempt: 2, by: "Other" })]}
      />,
    );
    expect(polite()).toBeEmptyDOMElement();
  });

  it("strict mode runs effects twice: the first list is still silent and one change is said once", () => {
    const { rerender } = render(
      <StrictMode>
        <ProcessingAnnouncer docs={[d("a", "scanning")]} />
      </StrictMode>,
    );
    expect(polite()).toBeEmptyDOMElement();
    rerender(
      <StrictMode>
        <ProcessingAnnouncer docs={[d("a", "ready")]} />
      </StrictMode>,
    );
    expect(polite().children).toHaveLength(1);
  });

  it("a document that appears after the first list (another page, a new upload) is not announced", () => {
    const { rerender } = render(<ProcessingAnnouncer docs={[d("a", "scanning")]} />);
    rerender(<ProcessingAnnouncer docs={[d("a", "scanning"), d("n", "failed")]} />);
    expect(alert()).toBeEmptyDOMElement();
  });

  it("a document that leaves the list says nothing", () => {
    const { rerender } = render(
      <ProcessingAnnouncer docs={[d("a", "scanning"), d("b", "ready")]} />,
    );
    rerender(<ProcessingAnnouncer docs={[d("b", "ready")]} />);
    expect(polite()).toBeEmptyDOMElement();
    expect(alert()).toBeEmptyDOMElement();
  });

  it("two documents changing in one refetch are both said, in list order", () => {
    const { rerender } = render(
      <ProcessingAnnouncer docs={[d("a", "scanning"), d("b", "reading")]} />,
    );
    rerender(<ProcessingAnnouncer docs={[d("a", "reading"), d("b", "ready")]} />);
    expect([...polite().children].map((c) => c.textContent)).toEqual([
      "a.pdf: reading details.",
      "b.pdf: ready.",
    ]);
  });
});

describe("clean-up", () => {
  it("each announcement leaves after its own time, not the next one's", () => {
    const { rerender } = render(
      <ProcessingAnnouncer docs={[d("a", "scanning"), d("b", "scanning")]} />,
    );
    rerender(<ProcessingAnnouncer docs={[d("a", "ready"), d("b", "scanning")]} />);
    act(() => void vi.advanceTimersByTime(3000));
    rerender(<ProcessingAnnouncer docs={[d("a", "ready"), d("b", "ready")]} />);
    expect(polite().children).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(ANNOUNCEMENT_MS - 3000));
    expect([...polite().children].map((c) => c.textContent)).toEqual(["b.pdf: ready."]);
    act(() => void vi.advanceTimersByTime(3000));
    expect(polite()).toBeEmptyDOMElement();
  });

  it("leaving the page cancels the timers: nothing runs after unmount", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender, unmount } = render(<ProcessingAnnouncer docs={[d("a", "scanning")]} />);
    rerender(<ProcessingAnnouncer docs={[d("a", "ready")]} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => void vi.advanceTimersByTime(ANNOUNCEMENT_MS * 2));
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("the same words said again are a new element each time (not a text swap a reader skips)", () => {
    const { rerender } = render(<ProcessingAnnouncer docs={[d("a", "reading")]} />);
    const cycle = () => {
      rerender(<ProcessingAnnouncer docs={[d("a", "failed")]} />);
      const el = alert().lastElementChild;
      rerender(<ProcessingAnnouncer docs={[d("a", "reading")]} />);
      return el;
    };
    const first = cycle();
    const second = cycle();
    expect(second).not.toBe(first);
    expect(alert().children).toHaveLength(2);
  });
});

describe("what a name can do", () => {
  it("a document name with markup is text in the region, never an element", () => {
    const { rerender } = render(
      <ProcessingAnnouncer docs={[d("a", "scanning", "<img src=x onerror=alert(1)>")]} />,
    );
    rerender(<ProcessingAnnouncer docs={[d("a", "ready", "<img src=x onerror=alert(1)>")]} />);
    expect(document.querySelector("img")).toBeNull();
    expect(polite()).toHaveTextContent("<img src=x onerror=alert(1)>");
  });

  it("a very long name is shortened so one announcement stays short", () => {
    const long = `${"x".repeat(200)}.pdf`;
    const { rerender } = render(<ProcessingAnnouncer docs={[d("a", "scanning", long)]} />);
    rerender(<ProcessingAnnouncer docs={[d("a", "ready", long)]} />);
    expect(polite().textContent!.length).toBeLessThan(80);
  });

  it("a hostile system name in a failure is cleaned of direction marks", () => {
    const { rerender } = render(<ProcessingAnnouncer docs={[d("a", "scanning")]} />);
    rerender(
      <ProcessingAnnouncer
        docs={[
          d("a", "failed", "a.pdf", {
            mode: "external",
            by: "Acme\u202E AV",
            step: "scan",
            reason: "scanError",
          }),
        ]}
      />,
    );
    expect(alert().textContent).not.toContain("\u202E");
  });
});
