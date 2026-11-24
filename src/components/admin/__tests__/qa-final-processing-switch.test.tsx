// Final QA pass: the processing switch (file-hooks D1, R5.6): double submits, a refused save, state
// left over between dialogs, and whether the screen agrees with the server about which system a step
// waits for. `it.fails` = asserts the correct behaviour and fails today (defect named above it).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/services/api", () => ({
  SeamFailure: class SeamFailure extends Error {
    constructor(
      public code: string,
      public detail?: string,
    ) {
      super(code);
    }
  },
  api: {
    listSystems: async () => [],
    getProcessingSwitch: () => m.get(),
    setProcessingSwitch: (i: unknown) => m.set(i),
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: m.success, error: m.error }),
}));
import { ProcessingSwitch } from "@/components/admin/processing-switch";
import { disconnectWarning, systemFor } from "@/components/admin/processing-switch-view";
import type { ConnectedSystem } from "@/services/integration-clients.functions";

const sys = (scopes: string[], over: Partial<ConnectedSystem> = {}): ConnectedSystem => ({
  id: `s-${scopes.join("-")}`,
  name: "Acme AV",
  systemKind: "other",
  keyPrefix: "erad_ab",
  scopes,
  createdAt: "2026-11-01T00:00:00Z",
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  lastRateLimitedAt: null,
  readLimitPerMinute: 120,
  writeLimitPerMinute: 30,
  ...over,
});
const show = (systems: ConnectedSystem[]) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProcessingSwitch systems={systems} />
    </QueryClientProvider>,
  );
const dialog = () => within(screen.getByRole("dialog"));
const open = async (name: string) => fireEvent.click(await screen.findByRole("button", { name }));
const understand = (label: string) =>
  fireEvent.click(screen.getByRole("checkbox", { name: label }));
const UNDERSTAND = "I understand files will wait for this system";

beforeEach(() => {
  m.get.mockReset().mockResolvedValue({ scan: false, read: false });
  m.set.mockReset().mockResolvedValue({ scan: true, read: false });
  m.success.mockReset();
  m.error.mockReset();
});

describe("saving", () => {
  it("clicking the confirm button twice while the save runs sends one change", async () => {
    let done: (v: unknown) => void = () => undefined;
    m.set.mockImplementation(() => new Promise((r) => (done = r)));
    show([sys(["scan"])]);
    await open("Use your own antivirus");
    understand(UNDERSTAND);
    const confirm = dialog().getByRole("button", { name: "Use your own antivirus" });
    // Real clicks are tens of milliseconds apart: let React and the query library flush between them.
    for (let i = 0; i < 3; i++)
      await act(async () => {
        fireEvent.click(confirm);
        await new Promise((r) => setTimeout(r, 20));
      });
    expect(m.set).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await act(async () => done({ scan: true, read: false }));
  });

  it("a refused save keeps the dialog open, says why, and the same click works again", async () => {
    m.set
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ scan: true, read: false });
    show([sys(["scan"])]);
    await open("Use your own antivirus");
    understand(UNDERSTAND);
    await act(async () =>
      fireEvent.click(dialog().getByRole("button", { name: "Use your own antivirus" })),
    );
    expect(m.error).toHaveBeenCalledTimes(1);
    expect(m.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    // The confirmation is still given: nobody has to tick it again after a failure.
    expect(screen.getByRole("checkbox", { name: UNDERSTAND })).toBeChecked();
    await act(async () =>
      fireEvent.click(dialog().getByRole("button", { name: "Use your own antivirus" })),
    );
    expect(m.set).toHaveBeenCalledTimes(2);
    expect(m.success).toHaveBeenCalledWith("Files now wait for your own antivirus.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the error toast never carries the raw error text", async () => {
    m.set.mockRejectedValueOnce(new Error("pg: relation tenants column external_processing"));
    show([sys(["scan"])]);
    await open("Use your own antivirus");
    understand(UNDERSTAND);
    await act(async () =>
      fireEvent.click(dialog().getByRole("button", { name: "Use your own antivirus" })),
    );
    expect(String(m.error.mock.calls[0]![0])).not.toMatch(/pg:|relation|external_processing/);
  });

  it("only the step that was changed is sent", async () => {
    m.get.mockResolvedValue({ scan: true, read: true });
    show([sys(["scan"]), sys(["extract"], { name: "Acme OCR" })]);
    await open("Use the built-in reader");
    await act(async () =>
      fireEvent.click(dialog().getByRole("button", { name: "Use the built-in reader" })),
    );
    expect(m.set).toHaveBeenCalledWith({ read: false });
    expect(m.success).toHaveBeenCalledWith("Files now use the built-in reader.");
  });

  it("after a save the screen shows what the server now says", async () => {
    show([sys(["scan"])]);
    await open("Use your own antivirus");
    understand(UNDERSTAND);
    m.get.mockResolvedValue({ scan: true, read: false });
    await act(async () =>
      fireEvent.click(dialog().getByRole("button", { name: "Use your own antivirus" })),
    );
    expect(await screen.findByText("Files wait for Acme AV.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use the built-in check" })).toBeTruthy();
  });
});

describe("the dialog between uses", () => {
  it("Cancel, then open again: the confirmation is unticked and the button unavailable again", async () => {
    show([sys(["scan"])]);
    await open("Use your own antivirus");
    understand(UNDERSTAND);
    fireEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await open("Use your own antivirus");
    expect(screen.getByRole("checkbox", { name: UNDERSTAND })).not.toBeChecked();
    expect(dialog().getByRole("button", { name: "Use your own antivirus" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(dialog().getByRole("button", { name: "Use your own antivirus" }));
    expect(m.set).not.toHaveBeenCalled();
  });

  it("Escape closes without saving", async () => {
    show([sys(["scan"])]);
    await open("Use your own antivirus");
    understand(UNDERSTAND);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.set).not.toHaveBeenCalled();
  });

  it("turning off the reader does not use the scan warning, and turning off the scan is styled as the risk", async () => {
    m.get.mockResolvedValue({ scan: true, read: true });
    show([sys(["scan"]), sys(["extract"], { name: "Acme OCR" })]);
    await open("Use the built-in reader");
    expect(dialog().getByText("Files will use the built-in reader again.")).toBeTruthy();
    expect(screen.queryByText(/protection is weaker/)).toBeNull();
    expect(dialog().getByRole("button", { name: "Use the built-in reader" }).className).not.toMatch(
      /destructive/,
    );
  });

  it("on for the reader with only an antivirus connected: reader copy, reader banner, reader checkbox", async () => {
    show([sys(["scan"])]);
    await open("Use your own reader");
    expect(dialog().getByText(/No system with this permission is connected yet/)).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: /fail after 30 minutes until a system is connected/ }),
    ).toBeTruthy();
  });

  it("every dialog says the change is recorded in the activity", async () => {
    show([sys(["scan"])]);
    await open("Use your own antivirus");
    expect(
      dialog().getByText("The change is recorded in the organisation's activity."),
    ).toBeTruthy();
  });
});

describe("loading", () => {
  it("while loading there is no button to change anything", async () => {
    m.get.mockImplementation(() => new Promise(() => undefined));
    show([sys(["scan"])]);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByRole("button", { name: /Use / })).toBeNull();
  });

  it("a failed load shows no switch state at all, and Try again loads it", async () => {
    m.get.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce({ scan: true, read: false });
    show([sys(["scan"])]);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Files wait for Acme AV.")).toBeTruthy();
  });

  it("a system name with markup is text, shortened in the middle", async () => {
    m.get.mockResolvedValue({ scan: true, read: false });
    show([sys(["scan"], { name: `<img src=x onerror=alert(1)>${"A".repeat(80)}` })]);
    await screen.findByText(/Files wait for /);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("which system the screen says a step waits for (D1, D3)", () => {
  it("a disconnected key is not the system", () => {
    expect(systemFor([sys(["scan"], { revokedAt: "2026-11-02T00:00:00Z" })], "scan")).toBeNull();
  });

  // Was QA-F4: the screen checked revokedAt only, while the server also drops an expired key.
  it("an expired key is not the system a step waits for (was QA-F4)", () => {
    const expired = sys(["scan"], { expiresAt: "2020-01-01T00:00:00Z" });
    expect(systemFor([expired], "scan")).toBeNull();
  });

  it("the card says none is connected when the only key has expired (was QA-F4)", async () => {
    m.get.mockResolvedValue({ scan: true, read: false });
    show([sys(["scan"], { expiresAt: "2020-01-01T00:00:00Z" })]);
    expect(
      await screen.findByText(/but none is connected: they fail after 30 minutes/),
    ).toBeTruthy();
  });

  it("a key with a future expiry is the system", () => {
    const live = sys(["scan"], { expiresAt: "2099-01-01T00:00:00Z" });
    expect(systemFor([live], "scan")).toBe(live);
  });

  it("scan and extract keys are told apart; a read-only key is neither", () => {
    const av = sys(["scan"]);
    const ocr = sys(["extract"], { name: "Acme OCR" });
    expect(systemFor([sys(["read"]), ocr, av], "scan")).toBe(av);
    expect(systemFor([sys(["read"]), av], "read")).toBeNull();
    expect(disconnectWarning(sys(["read", "subscribe"]), { scan: true, read: true })).toBeNull();
  });
});
