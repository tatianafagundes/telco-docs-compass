// The screens for a document's processing (file-hooks spec R5.1–R5.5): the upload card, the panel
// notice and the announcer. The API is mocked; what each action is allowed to do is the server's job.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const advancePipeline = vi.fn();
const updateMetadata = vi.fn();
const reportProblem = vi.fn();
vi.mock("@/services/api", () => ({
  api: {
    advancePipeline: (i: unknown) => advancePipeline(i),
    updateMetadata: (i: unknown) => updateMetadata(i),
    reportProblem: (i: unknown) => reportProblem(i),
  },
  newIdempotencyKey: () => "k",
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
import { ANNOUNCEMENT_MS, ProcessingAnnouncer } from "@/components/documents/processing-announcer";
import { ProcessingNotice } from "@/components/documents/processing-notice";
import { UploadProgress } from "@/components/upload/upload-progress";
import type { UploadRow } from "@/hooks/use-upload";
import type { PipelineState } from "@/schemas/document";

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);
const row = (state: UploadRow["state"], over: Partial<UploadRow> = {}): UploadRow => ({
  key: "k1",
  name: "Report.pdf",
  file: new File(["x"], "Report.pdf"),
  documentType: "contract",
  docId: "d1",
  state,
  uploaded: true,
  ...over,
});
const handlers = () => ({
  onCancel: vi.fn(),
  onRetryUpload: vi.fn(),
  onRetryStep: vi.fn(),
  onKeepUnread: vi.fn(),
  onReport: vi.fn(),
  onDelete: vi.fn(),
  onShowAttention: vi.fn(),
  onDismiss: vi.fn(),
});
const card = (r: UploadRow, detail: unknown, canDelete = true) => {
  const h = handlers();
  render(
    <UploadProgress rows={[r]} details={new Map([["d1", detail]])} canDelete={canDelete} {...h} />,
  );
  return h;
};
const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);
const ext = { mode: "external", by: "Acme AV", byClient: "c1", step: "scan", attempt: 1 };

beforeEach(() => {
  advancePipeline.mockReset().mockResolvedValue({ id: "d1", state: "scanning", retried: true });
  updateMetadata.mockReset().mockResolvedValue({});
  reportProblem.mockReset().mockResolvedValue({});
});

describe("the upload card (R5.1–R5.3)", () => {
  it("a built-in step has the simulated tooltip trigger; an outside one names who it waits for", () => {
    card(row("scanning"), { mode: "simulated" });
    expect(document.querySelector('[tabindex="0"]')).not.toBeNull();
  });
  it("an outside step has no simulated tooltip and says it waits for the system", () => {
    card(row("scanning"), { ...ext, since: new Date(2026, 10, 24, 14, 5).toISOString() });
    expect(document.querySelector('[tabindex="0"]')).toBeNull();
    expect(screen.getByText("Waiting for Acme AV · Since 14:05")).toBeInTheDocument();
  });
  it("a system's name with markup is shown as text, never as HTML", () => {
    card(row("failed"), { ...ext, reason: "scanError", by: "<img src=x onerror=alert(1)>" });
    expect(document.querySelector("img")).toBeNull();
    expect(
      screen.getByText(/<img src=x onerror=alert\(1\)> couldn't check this file/),
    ).toBeTruthy();
  });
  it("a scan that got no answer offers Try again, never Keep without reading", () => {
    const h = card(row("failed"), { ...ext, reason: "noResult" });
    expect(screen.getByText("Acme AV didn't answer within 30 minutes. Try again.")).toBeTruthy();
    expect(buttons()).toContain("Try again");
    expect(buttons()).not.toContain("Keep without reading");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.onRetryStep).toHaveBeenCalledTimes(1);
  });
  it("a reading that got no answer offers Try again and Keep without reading", () => {
    card(row("failed"), { ...ext, step: "read", by: "Acme OCR", reason: "noResult" });
    expect(buttons()).toEqual(expect.arrayContaining(["Try again", "Keep without reading"]));
  });
  it("a file that never arrived offers only Delete to a manager, and a sentence to others", () => {
    card(row("failed"), { reason: "noFile" }, true);
    expect(screen.getByText("The file never arrived. Add it again.")).toBeTruthy();
    expect(screen.getByText("No file yet")).toBeTruthy();
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Delete"]);
  });
  it("no disabled Delete for people who cannot delete: one sentence instead (design review S6)", () => {
    card(row("failed"), { reason: "noFile" }, false);
    expect(within(screen.getByRole("list")).queryAllByRole("button")).toEqual([]);
    expect(screen.getByText("A manager can delete this file.")).toBeTruthy();
  });
  it("a scan failure is tagged Couldn't check, never Couldn't read (design review B2)", () => {
    card(row("failed"), { ...ext, reason: "scanError" });
    expect(screen.getByText("Couldn't check")).toBeTruthy();
    expect(screen.queryByText("Couldn't read")).toBeNull();
  });
  it("Report a problem, Try again and Keep without reading follow the person's rights (S7)", () => {
    const h = handlers();
    render(
      <UploadProgress
        rows={[row("quarantined"), row("failed", { key: "k2", docId: "d2" })]}
        details={
          new Map<string, unknown>([
            ["d1", { ...ext, reason: "threat" }],
            ["d2", { reason: "unreadable", step: "read" }],
          ])
        }
        canDelete={false}
        canEdit={false}
        canReport={false}
        {...h}
      />,
    );
    expect(within(screen.getByRole("list")).queryAllByRole("button")).toEqual([]);
    expect(
      screen.getByText("An editor can try again. A manager can delete this file."),
    ).toBeTruthy();
  });
  it("after an action, focus stays on the row (design review S5)", async () => {
    const h = card(row("failed"), { ...ext, reason: "scanError" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.onRetryStep).toHaveBeenCalled();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(document.querySelector('[data-upload-row="k1"]'));
  });
  it("a batch whose files only wait for an outside system is added, and can be dismissed (S1)", () => {
    card(row("scanning"), ext);
    expect(screen.getByRole("heading", { name: "1 added: 1 waiting" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
  it("a blocked file says how to go on and offers Report a problem", () => {
    const h = card(row("quarantined"), { ...ext, reason: "threat" });
    expect(screen.getByText(/add a clean new version/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(h.onReport).toHaveBeenCalledTimes(1);
  });
  it("an upload that stopped keeps its own copy and Try again", () => {
    const h = card(row("error"), null);
    expect(screen.getByText("Upload stopped. Nothing was added. Try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.onRetryUpload).toHaveBeenCalledTimes(1);
    expect(h.onRetryStep).not.toHaveBeenCalled();
  });
});

describe("the panel notice", () => {
  const notice = (state: PipelineState, detail: unknown, role = "contributor") =>
    render(
      wrap(
        <ProcessingNotice
          doc={{ id: "d1", pipeline_state: state, pipeline_detail: detail }}
          entityId="e1"
          role={role as never}
        />,
      ),
    );
  it("Try again restarts the failed step on the server", async () => {
    notice("failed", { ...ext, reason: "scanError" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(advancePipeline).toHaveBeenCalledWith({ id: "d1", retry: true });
  });
  it("Keep without reading keeps the file", async () => {
    notice("failed", { reason: "unreadable", step: "read" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep without reading" }));
    });
    expect(updateMetadata).toHaveBeenCalledWith({ id: "d1", patch: { keepUnread: true } });
  });
  it("a viewer sees what happened but no action it cannot take", () => {
    notice("failed", { reason: "unreadable", step: "read" }, "viewer");
    expect(screen.getByText(/couldn't read the text/)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
  it("says who can act where the person cannot, and where Delete is for a manager (S6)", () => {
    notice("failed", { reason: "unreadable", step: "read" }, "viewer");
    expect(
      screen.getByText("An editor can try again. A manager can delete this file."),
    ).toBeTruthy();
  });
  it("a manager is told Delete is in the menu above", () => {
    notice("quarantined", { ...ext, reason: "threat" }, "manager");
    expect(screen.getByText("Delete is in the menu above.")).toBeTruthy();
  });
  it("nothing for a ready document", () => {
    const { container } = notice("ready", null);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the announcer (R5.5)", () => {
  const docs = (a: PipelineState, b: PipelineState) => [
    { id: "a", name: "A.pdf", pipeline_state: a },
    { id: "b", name: "B.pdf", pipeline_state: b },
  ];
  it("says nothing on the first list, then each change once, failures as an alert", () => {
    const { rerender } = render(<ProcessingAnnouncer docs={docs("scanning", "reading")} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("alert")).toHaveTextContent("");
    rerender(<ProcessingAnnouncer docs={docs("reading", "failed")} />);
    expect(screen.getByRole("status")).toHaveTextContent("A.pdf: reading details.");
    expect(screen.getByRole("alert")).toHaveTextContent("B.pdf: couldn't read.");
    rerender(<ProcessingAnnouncer docs={docs("reading", "failed")} />);
    expect(screen.getByRole("status").children).toHaveLength(1);
  });
  it("the same failure again after Try again is a new announcement (design review B1)", () => {
    const { rerender } = render(<ProcessingAnnouncer docs={docs("reading", "reading")} />);
    rerender(<ProcessingAnnouncer docs={docs("reading", "failed")} />);
    const first = screen.getByRole("alert").firstElementChild;
    rerender(<ProcessingAnnouncer docs={docs("reading", "reading")} />);
    rerender(<ProcessingAnnouncer docs={docs("reading", "failed")} />);
    const alerts = screen.getByRole("alert").children;
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).not.toBe(first);
    expect(alerts[1]).toHaveTextContent("B.pdf: couldn't read.");
  });
  it("each announcement leaves the page after a few seconds", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<ProcessingAnnouncer docs={docs("scanning", "reading")} />);
      rerender(<ProcessingAnnouncer docs={docs("reading", "failed")} />);
      rerender(<ProcessingAnnouncer docs={docs("ready", "failed")} />);
      act(() => void vi.advanceTimersByTime(ANNOUNCEMENT_MS));
      expect(screen.getByRole("alert").children).toHaveLength(0);
      expect(screen.getByRole("status").children).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("never moves focus", () => {
    const b = document.createElement("button");
    document.body.appendChild(b);
    b.focus();
    const { rerender } = render(<ProcessingAnnouncer docs={docs("scanning", "reading")} />);
    rerender(<ProcessingAnnouncer docs={docs("quarantined", "ready")} />);
    expect(document.activeElement).toBe(b);
    b.remove();
  });
});
