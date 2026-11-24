// Admin > Connected systems: the organisation's own antivirus and reader (file-hooks spec D1, D4,
// R5.6). The API is mocked; who may change the switch is the server's job.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const getProcessingSwitch = vi.fn();
const setProcessingSwitch = vi.fn();
vi.mock("@/services/api", () => ({
  api: {
    listSystems: async () => [],
    getProcessingSwitch: () => getProcessingSwitch(),
    setProcessingSwitch: (i: unknown) => setProcessingSwitch(i),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
import { ConnectedSystems } from "@/components/admin/connected-systems";
import { ProcessingSwitch } from "@/components/admin/processing-switch";
import {
  disconnectWarning,
  STEP_COPY,
  systemFor,
  withScope,
} from "@/components/admin/processing-switch-view";
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

beforeEach(() => {
  getProcessingSwitch.mockReset().mockResolvedValue({ scan: false, read: false });
  setProcessingSwitch.mockReset().mockResolvedValue({ scan: true, read: false });
});

describe("choosing permissions (D4)", () => {
  it("checking files or reading files is a key of its own", () => {
    expect(withScope(["read", "subscribe"], "scan")).toEqual(["scan"]);
    expect(withScope(["scan"], "extract")).toEqual(["extract"]);
    expect(withScope(["scan"], "read")).toEqual(["read"]);
    expect(withScope(["read"], "subscribe")).toEqual(["read", "subscribe"]);
  });
});

describe("which system a step waits for", () => {
  it("the connected key with that one permission, never a disconnected one", () => {
    const av = sys(["scan"]);
    const reader = sys(["extract"], { name: "Acme OCR" });
    expect(systemFor([sys(["read"]), av, reader], "scan")).toBe(av);
    expect(systemFor([av, reader], "read")).toBe(reader);
    expect(systemFor([sys(["scan"], { revokedAt: "2026-11-02T00:00:00Z" })], "scan")).toBeNull();
  });
  it("disconnecting it warns about waiting files only when files wait for it", () => {
    const av = sys(["scan"]);
    expect(disconnectWarning(av, { scan: true, read: false })).toBe(STEP_COPY.scan.disconnect);
    expect(disconnectWarning(av, { scan: false, read: true })).toBeNull();
    expect(disconnectWarning(av, undefined)).toBe(STEP_COPY.scan.disconnect);
    expect(disconnectWarning(sys(["read"]), { scan: true, read: true })).toBeNull();
  });
});

describe("the switch", () => {
  it("turning a step on needs the confirmation, and says what happens", async () => {
    show([sys(["scan"])]);
    fireEvent.click(await screen.findByRole("button", { name: "Use your own antivirus" }));
    expect(
      screen.getByText(/Files wait for your own antivirus\. The built-in check stops\./),
    ).toBeTruthy();
    // The confirm button names the result, never "Turn on" (design review B3).
    const dialog = () => within(screen.getByRole("dialog"));
    const turnOn = dialog().getByRole("button", { name: "Use your own antivirus" });
    expect(turnOn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(turnOn);
    expect(setProcessingSwitch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "I understand files will wait for this system" }),
    );
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Use your own antivirus" }));
    });
    expect(setProcessingSwitch).toHaveBeenCalledWith({ scan: true });
  });
  it("with no system connected, says files would wait and fail", async () => {
    show([]);
    fireEvent.click(await screen.findByRole("button", { name: "Use your own antivirus" }));
    expect(screen.getByText(/No system with this permission is connected yet/)).toBeTruthy();
    expect(
      screen.getByRole("checkbox", {
        name: "I understand files will fail after 30 minutes until a system is connected",
      }),
    ).toBeTruthy();
  });
  it("turning it off warns that protection is weaker, without a checkbox", async () => {
    getProcessingSwitch.mockResolvedValue({ scan: true, read: false });
    show([sys(["scan"])]);
    expect(await screen.findByText("Files wait for Acme AV.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use the built-in check" }));
    expect(screen.getByText(/protection is weaker/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // Lowering protection looks like the risk it is.
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Use the built-in check" })
        .className,
    ).toMatch(/destructive|critical|danger/);
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Use the built-in check" }),
      );
    });
    expect(setProcessingSwitch).toHaveBeenCalledWith({ scan: false });
  });
  it("on with no system connected says files fail after the timeout", async () => {
    getProcessingSwitch.mockResolvedValue({ scan: false, read: true });
    show([]);
    await waitFor(() =>
      expect(
        screen.getByText(/Files wait for your own reader, but none is connected/),
      ).toBeTruthy(),
    );
  });
  it("a failed load offers Try again", async () => {
    getProcessingSwitch.mockRejectedValue(new Error("x"));
    show([]);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("connecting a system that checks files (design review S4)", () => {
  it("names it for what it does and says the other permissions were cleared", async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ConnectedSystems />
      </QueryClientProvider>,
    );
    fireEvent.click((await screen.findAllByRole("button", { name: "Connect a system" }))[0]!);
    const d = within(screen.getByRole("dialog"));
    expect(d.getByRole("textbox", { name: "Name shown in activity" })).toHaveValue("Order care");
    fireEvent.click(
      d.getByRole("checkbox", { name: "Check files for threats and report the result" }),
    );
    expect(d.getByRole("textbox", { name: "Name shown in activity" })).toHaveValue("Antivirus");
    expect(
      d.getByText("Other permissions were cleared: this system can only check files."),
    ).toBeTruthy();
    expect(
      d.getByRole("checkbox", { name: "Read documents and download files" }),
    ).not.toBeChecked();
  });
  it("a name the admin typed is kept", async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ConnectedSystems />
      </QueryClientProvider>,
    );
    fireEvent.click((await screen.findAllByRole("button", { name: "Connect a system" }))[0]!);
    const d = within(screen.getByRole("dialog"));
    fireEvent.change(d.getByRole("textbox", { name: "Name shown in activity" }), {
      target: { value: "Acme AV" },
    });
    fireEvent.click(
      d.getByRole("checkbox", { name: "Check files for threats and report the result" }),
    );
    expect(d.getByRole("textbox", { name: "Name shown in activity" })).toHaveValue("Acme AV");
  });
});
