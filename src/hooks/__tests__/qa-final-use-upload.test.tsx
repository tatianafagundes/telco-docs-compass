// Final QA pass: useUpload.sync (file-hooks R5.4) and the walk it must not disturb: rows this page
// is walking, rows that stopped, Try again, and the six-step limit.
// `it.fails` = asserts the correct behaviour and fails today (defect named above it).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  advancePipeline: vi.fn(),
  register: vi.fn(),
  uploadContent: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@/services/api", () => ({
  api: {
    register: (i: unknown) => m.register(i),
    uploadContent: (...a: unknown[]) => m.uploadContent(...a),
    advancePipeline: (i: unknown) => m.advancePipeline(i),
    delete: (i: unknown) => m.del(i),
  },
  newIdempotencyKey: () => "k",
}));
import { useUpload } from "@/hooks/use-upload";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
const file = (name = "Report.pdf") => new File(["x"], name, { type: "application/pdf" });
const plan = (key = "k1") => [{ key, file: file(), documentType: "contract" }];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  if (!File.prototype.arrayBuffer)
    File.prototype.arrayBuffer = async () => new Uint8Array([1]).buffer;
  m.advancePipeline.mockReset();
  m.register.mockReset().mockResolvedValue({
    document: { id: "d1", tenant_id: "t1" },
    upload: { versionId: "v1", token: "tk" },
  });
  m.uploadContent.mockReset().mockResolvedValue(undefined);
  m.del.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
});
async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(800);
  }
}
const waitingAnswer = { id: "d1", state: "scanning", retried: false, waiting: true };

async function started(answers: unknown[] = [waitingAnswer]) {
  answers.forEach((a) => m.advancePipeline.mockResolvedValueOnce(a));
  const hook = renderHook(() => useUpload("e1"), { wrapper });
  await act(async () => {
    hook.result.current.start(plan());
    await settle();
  });
  return hook;
}

describe("sync leaves alone what it must", () => {
  it("a row whose file has not been uploaded yet keeps its own state, whatever the list says", async () => {
    m.uploadContent.mockImplementation(() => new Promise(() => undefined));
    const { result } = renderHook(() => useUpload("e1"), { wrapper });
    await act(async () => {
      result.current.start(plan());
      await settle();
    });
    expect(result.current.rows[0]).toMatchObject({
      docId: "d1",
      uploaded: false,
      state: "uploading",
    });
    act(() => result.current.sync([{ id: "d1", pipeline_state: "failed" }]));
    expect(result.current.rows[0]!.state).toBe("uploading");
  });

  it("a cancelled row stays cancelled", async () => {
    const { result } = await started();
    act(() => result.current.cancel("k1"));
    act(() => result.current.sync([{ id: "d1", pipeline_state: "failed" }]));
    expect(result.current.rows[0]!.state).toBe("cancelled");
  });

  it("a document missing from the list (deleted, other page) leaves the row as it is", async () => {
    const { result } = await started();
    act(() => result.current.sync([{ id: "other", pipeline_state: "failed" }]));
    expect(result.current.rows[0]!.state).toBe("scanning");
    act(() => result.current.sync([]));
    expect(result.current.rows[0]!.state).toBe("scanning");
  });

  it("a list that agrees with the rows changes nothing: same rows array, no re-render churn", async () => {
    const { result } = await started();
    const before = result.current.rows;
    act(() => result.current.sync([{ id: "d1", pipeline_state: "scanning" }]));
    expect(result.current.rows).toBe(before);
  });

  it("only the row whose document changed is replaced; the others keep their identity", async () => {
    m.register
      .mockResolvedValueOnce({
        document: { id: "d1", tenant_id: "t1" },
        upload: { versionId: "v1", token: "t" },
      })
      .mockResolvedValueOnce({
        document: { id: "d2", tenant_id: "t1" },
        upload: { versionId: "v2", token: "t" },
      });
    m.advancePipeline.mockResolvedValue(waitingAnswer);
    const { result } = renderHook(() => useUpload("e1"), { wrapper });
    await act(async () => {
      result.current.start([...plan("k1"), ...plan("k2")]);
      await settle();
    });
    const [r1, r2] = result.current.rows;
    act(() =>
      result.current.sync([
        { id: "d1", pipeline_state: "scanning" },
        { id: "d2", pipeline_state: "quarantined" },
      ]),
    );
    expect(result.current.rows[0]).toBe(r1);
    expect(result.current.rows[1]).not.toBe(r2);
    expect(result.current.rows[1]!.state).toBe("quarantined");
  });
});

describe("the walk and Try again", () => {
  it("Try again sends retry on the first call only", async () => {
    const { result } = await started([{ ...waitingAnswer, state: "scanning" }]);
    act(() => result.current.sync([{ id: "d1", pipeline_state: "failed" }]));
    m.advancePipeline
      .mockReset()
      .mockResolvedValueOnce({ id: "d1", state: "scanning", retried: true })
      .mockResolvedValueOnce({ id: "d1", state: "scanning", retried: false, waiting: true });
    await act(async () => {
      result.current.retryStep(result.current.rows[0]!);
      await settle();
    });
    expect(m.advancePipeline.mock.calls).toEqual([[{ id: "d1", retry: true }], [{ id: "d1" }]]);
    expect(result.current.rows[0]).toMatchObject({ state: "scanning", retried: true });
  });

  it("while Try again is being walked, a list that still says failed does not flip the row back", async () => {
    const { result } = await started();
    act(() => result.current.sync([{ id: "d1", pipeline_state: "failed" }]));
    let answer: (v: unknown) => void = () => undefined;
    m.advancePipeline.mockReset().mockImplementation(() => new Promise((r) => (answer = r)));
    await act(async () => {
      result.current.retryStep(result.current.rows[0]!);
      await settle();
    });
    act(() => result.current.sync([{ id: "d1", pipeline_state: "failed" }]));
    act(() => result.current.sync([{ id: "d1", pipeline_state: "ready" }]));
    expect(result.current.rows[0]!.state).toBe("failed");
    await act(async () => {
      answer({ id: "d1", state: "scanning", retried: true, waiting: true });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.rows[0]!.state).toBe("scanning");
    // Walk over: the list may now move the row again (an answer, a timeout).
    act(() => result.current.sync([{ id: "d1", pipeline_state: "failed" }]));
    expect(result.current.rows[0]!.state).toBe("failed");
  });

  it("a timeout, then Try again, then a timeout again: the row follows each time", async () => {
    const { result } = await started();
    for (let round = 0; round < 3; round++) {
      act(() => result.current.sync([{ id: "d1", pipeline_state: "failed" }]));
      expect(result.current.rows[0]!.state).toBe("failed");
      m.advancePipeline
        .mockReset()
        .mockResolvedValue({ id: "d1", state: "scanning", retried: true, waiting: true });
      await act(async () => {
        result.current.retryStep(result.current.rows[0]!);
        await settle();
      });
      expect(result.current.rows[0]!.state).toBe("scanning");
    }
  });

  it("an answer that never says ready or waiting stops after six calls and leaves no timer", async () => {
    m.advancePipeline.mockResolvedValue({ id: "d1", state: "scanning", retried: false });
    const { result } = renderHook(() => useUpload("e1"), { wrapper });
    await act(async () => {
      result.current.start(plan());
      await settle();
      await settle();
    });
    expect(m.advancePipeline).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.rows[0]!.state).toBe("scanning");
  });

  it("Try again on a row with no document does nothing", () => {
    const { result } = renderHook(() => useUpload("e1"), { wrapper });
    act(() =>
      result.current.retryStep({
        key: "k",
        name: "x",
        file: file(),
        documentType: "c",
        docId: null,
        state: "failed",
        retried: false,
        uploaded: false,
      }),
    );
    expect(m.advancePipeline).not.toHaveBeenCalled();
  });
});

describe("a step that could not be advanced after the file was stored", () => {
  async function stopped() {
    m.advancePipeline.mockRejectedValueOnce(new Error("pipeline.changed"));
    const hook = renderHook(() => useUpload("e1"), { wrapper });
    await act(async () => {
      hook.result.current.start(plan());
      await settle();
    });
    return hook;
  }

  it("the row is an error, and the document exists (the setup of the two tests below)", async () => {
    const { result } = await stopped();
    expect(result.current.rows[0]).toMatchObject({ state: "error", docId: "d1", uploaded: true });
    expect(m.del).not.toHaveBeenCalled();
  });

  // Defect QA-F3, Medium, src/hooks/use-upload.ts:164-172 (sync) with src/components/upload/upload-progress.tsx:118.
  // advancePipeline can fail after the document and its file are stored (another tab or the sweep moved it:
  // pipeline.changed; storage not yet readable: pipeline.notUploaded). The row becomes "error" and sync
  // skips it for good, so the card keeps saying "Upload stopped. Nothing was added." while the list shows
  // the document being scanned, failed or ready.
  it.fails("the list's state replaces an error row whose document is stored", async () => {
    const { result } = await stopped();
    act(() => result.current.sync([{ id: "d1", pipeline_state: "scanning" }]));
    expect(result.current.rows[0]!.state).toBe("scanning");
  });

  // Defect QA-F3b, Medium, src/hooks/use-upload.ts:145-148 (retryUpload). "Try again" on that row clears
  // docId and uploaded and registers the file again: a second document for the same file (and, with
  // outside processing, a second scan), while the first one carries on.
  it.fails(
    "Try again on an error row whose document is stored does not register the file a second time",
    async () => {
      const { result } = await stopped();
      await act(async () => {
        result.current.retryUpload(result.current.rows[0]!);
        await settle();
      });
      expect(m.register).toHaveBeenCalledTimes(1);
    },
  );

  it("an upload that really failed (the ticket upload threw) takes the half-registered document back out", async () => {
    m.uploadContent.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useUpload("e1"), { wrapper });
    await act(async () => {
      result.current.start(plan());
      await settle();
    });
    expect(m.del).toHaveBeenCalledWith({ id: "d1" });
    expect(result.current.rows[0]).toMatchObject({ state: "error", docId: null });
    act(() => result.current.sync([{ id: "d1", pipeline_state: "scanning" }]));
    expect(result.current.rows[0]!.state).toBe("error");
  });
});
