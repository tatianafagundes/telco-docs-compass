// Routes to adding documents: the record link in the panel, the record link in the results table,
// and "Choose a record" on the Documents page. The API is mocked; access itself is the server's job.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findRecord = vi.fn();
const searchDocuments = vi.fn();
vi.mock("@/services/api", () => ({
  api: {
    findRecord: (q: string) => findRecord(q),
    searchDocuments: (i: unknown) => searchDocuments(i),
  },
}));

import { RecordLine, NO_RECORD_ACCESS } from "@/components/documents/record-line";
import { ResultsTable } from "@/components/search/results-table";
import { ChooseRecordDialog } from "@/components/upload/choose-record-dialog";
import { takeFiles } from "@/components/upload/upload-handoff";
import type { SearchRow } from "@/services/search.functions";

/** Renders `ui` on "/" inside a router that also knows the record page, so links work. */
async function renderWithRouter(ui: () => ReactNode) {
  const root = createRootRoute({ component: () => <Outlet /> });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: ui });
  const record = createRoute({
    getParentRoute: () => root,
    path: "/records/$entityId",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <p>record page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, record]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  return router;
}

// jsdom has no ResizeObserver; the table only uses it to size its window of rows.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  findRecord.mockReset();
  searchDocuments.mockReset();
  searchDocuments.mockResolvedValue({ items: [], next: null });
});

describe("RecordLine in the document panel", () => {
  it("names the record as a link to its page", async () => {
    findRecord.mockResolvedValue([
      { id: "ord-se-77310", name: "O-77310 Other", type: "ProductOrder" },
      { id: "ord-se-7731", name: "O-7731 Fibre upgrade", type: "ProductOrder" },
    ]);
    await renderWithRouter(() => <RecordLine entityId="ord-se-7731" />);
    const link = await screen.findByRole("link", { name: "Order · O-7731 Fibre upgrade" });
    expect(link.getAttribute("href")).toBe("/records/ord-se-7731");
  });
  it("says nothing about the record of a directly shared document, and never asks for it", async () => {
    await renderWithRouter(() => <RecordLine entityId={null} />);
    expect(screen.getByText(NO_RECORD_ACCESS)).toBeTruthy();
    expect(findRecord).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("treats a record the person can't see like one they don't have access to", async () => {
    findRecord.mockResolvedValue([]);
    await renderWithRouter(() => <RecordLine entityId="ord-se-7731" />);
    expect(await screen.findByText(NO_RECORD_ACCESS)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

const row = (over: Partial<SearchRow> = {}): SearchRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Master agreement.pdf",
  document_type: "contract",
  status: "draft",
  sensitivity: "internal",
  legal_hold: false,
  updated_at: "2026-11-01T10:00:00Z",
  expiry_date: null,
  pending: 0,
  entity_id: "ord-se-7731",
  entity_name: "O-7731 Fibre upgrade",
  entity_type: "ProductOrder",
  ...over,
});

function table(rows: SearchRow[], onOpen = vi.fn(), onToggle = vi.fn()) {
  return () => (
    <ResultsTable
      rows={rows}
      activeId={undefined}
      onOpen={onOpen}
      selected={new Set()}
      onToggle={onToggle}
      onToggleAll={() => {}}
      allSelected={false}
      hasMore={false}
      loadingMore={false}
      onLoadMore={() => {}}
    />
  );
}

describe("the record link in the results table", () => {
  it("goes to the record on click, without opening the panel or ticking the row", async () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const router = await renderWithRouter(table([row()], onOpen, onToggle));
    const [link] = screen.getAllByRole("link", { name: /O-7731 Fibre upgrade/ });
    expect(link?.getAttribute("tabindex")).toBe("-1");
    await act(async () => {
      fireEvent.click(link as HTMLElement);
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/records/ord-se-7731"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });
  it("keeps the record in the narrow line a plain inline link, so the line can cut it by characters", async () => {
    await renderWithRouter(table([row()]));
    const links = screen.getAllByRole("link", { name: /O-7731 Fibre upgrade/ });
    const inLine = links.find((l) => l.closest('[class~="2xl:hidden"]'));
    expect(inLine).toBeTruthy();
    // inline-flex would make the whole link one unit that collapses to an ellipsis
    expect(inLine?.className).not.toContain("inline-flex");
  });
  it("has no link, and no record id, when the record can't be opened", async () => {
    await renderWithRouter(table([row({ entity_name: null })]));
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.innerHTML).not.toContain("ord-se-7731");
  });
  it("still opens the panel with Enter on the row", async () => {
    const onOpen = vi.fn();
    await renderWithRouter(table([row()], onOpen));
    const gridRow = screen.getByRole("row");
    fireEvent.keyDown(gridRow, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(row().id, "ord-se-7731");
  });
  it("lets Enter on a focused link follow it instead of opening the panel", async () => {
    const onOpen = vi.fn();
    await renderWithRouter(table([row()], onOpen));
    const [link] = screen.getAllByRole("link");
    fireEvent.keyDown(link as HTMLElement, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("Choose a record", () => {
  it("puts focus in the search field and searches only from 2 characters", async () => {
    findRecord.mockResolvedValue([
      { id: "ord-se-7731", name: "O-7731 Fibre upgrade", type: "ProductOrder" },
    ]);
    await renderWithRouter(() => <ChooseRecordDialog open onOpenChange={() => {}} />);
    const field = await screen.findByLabelText("Find an order, quote or account");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.change(field, { target: { value: "O" } });
    expect(await screen.findByText("Keep typing. 2 characters are enough to search.")).toBeTruthy();
    expect(findRecord).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "O-77" } });
    await screen.findByRole("button", { name: /O-7731 Fibre upgrade/ }, { timeout: 2000 });
    expect(findRecord).toHaveBeenCalledWith("O-77");
  });
  it("lets the person choose files for the record, hands them over and opens the record", async () => {
    findRecord.mockResolvedValue([
      { id: "ord-se-7731", name: "O-7731 Fibre upgrade", type: "ProductOrder" },
    ]);
    const onOpenChange = vi.fn();
    const router = await renderWithRouter(() => (
      <ChooseRecordDialog open onOpenChange={onOpenChange} />
    ));
    fireEvent.change(await screen.findByLabelText("Find an order, quote or account"), {
      target: { value: "O-77" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /O-7731 Fibre upgrade/ }, { timeout: 2000 }),
    );
    expect(
      await screen.findByText(/They will be added to Order · O-7731 Fibre upgrade/),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Choose files" })),
    );
    const file = new File(["%PDF"], "order.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("choose-files-input"), { target: { files: [file] } });
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/records/ord-se-7731"));
    expect(router.state.location.search).toEqual({ add: 1 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(takeFiles("ord-se-7731")).toEqual([file]);
  });
  it("goes back to the search with Choose a different record", async () => {
    findRecord.mockResolvedValue([
      { id: "ord-se-7731", name: "O-7731 Fibre upgrade", type: "ProductOrder" },
    ]);
    await renderWithRouter(() => <ChooseRecordDialog open onOpenChange={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Find an order, quote or account"), {
      target: { value: "O-77" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /O-7731 Fibre upgrade/ }, { timeout: 2000 }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Choose a different record" }));
    expect(await screen.findByLabelText("Find an order, quote or account")).toBeTruthy();
  });
  it("says why nothing was found", async () => {
    findRecord.mockResolvedValue([]);
    await renderWithRouter(() => <ChooseRecordDialog open onOpenChange={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Find an order, quote or account"), {
      target: { value: "Z-1" },
    });
    expect(
      await screen.findByText(/No record starts with “Z-1”/, undefined, { timeout: 2000 }),
    ).toBeTruthy();
  });
});
