// The upload card follows the list once this page stops walking a file's steps (file-hooks R5.4).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const advancePipeline = vi.fn();
vi.mock("@/services/api", () => ({
  api: {
    register: vi.fn(async () => ({
      document: { id: "d1", tenant_id: "t1" },
      upload: { versionId: "v1", token: "tk" },
    })),
    uploadContent: vi.fn(async () => undefined),
    advancePipeline: (i: unknown) => advancePipeline(i),
    delete: vi.fn(async () => undefined),
  },
  newIdempotencyKey: () => "k",
}));
import { useUpload } from "@/hooks/use-upload";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
const file = () => new File(["x"], "Report.pdf", { type: "application/pdf" });
// jsdom has no File.arrayBuffer in every version; the hash only needs some bytes.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  if (!File.prototype.arrayBuffer)
    File.prototype.arrayBuffer = async () => new Uint8Array([1]).buffer;
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
});

/** Lets the hash (real async) finish and the 700 ms step delay pass. */
async function settle() {
  // The hash is real async work (crypto.subtle): give it room even on a busy machine.
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 3; j++) await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(800);
  }
}
describe("useUpload.sync", () => {
  it("takes the list's state once the step waits for an outside system", async () => {
    advancePipeline.mockResolvedValue({
      id: "d1",
      state: "scanning",
      retried: false,
      waiting: true,
    });
    const { result } = renderHook(() => useUpload("e1"), { wrapper });
    await act(async () => {
      result.current.start([{ key: "k1", file: file(), documentType: "contract" }]);
      await settle();
    });
    expect(result.current.rows[0]).toMatchObject({ docId: "d1", state: "scanning" });
    act(() => result.current.sync([{ id: "d1", pipeline_state: "failed" }]));
    expect(result.current.rows[0]!.state).toBe("failed");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never overwrites a row this page is still walking", async () => {
    let answer: (v: unknown) => void = () => undefined;
    advancePipeline.mockImplementation(() => new Promise((r) => (answer = r)));
    const { result } = renderHook(() => useUpload("e1"), { wrapper });
    await act(async () => {
      result.current.start([{ key: "k1", file: file(), documentType: "contract" }]);
      await settle();
    });
    act(() => result.current.sync([{ id: "d1", pipeline_state: "failed" }]));
    expect(result.current.rows[0]!.state).toBe("uploading");
    await act(async () => {
      answer({ id: "d1", state: "ready", retried: false });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.rows[0]!.state).toBe("ready");
  });
});
