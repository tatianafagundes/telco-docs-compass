// The simulated processing step made safe (file-hooks spec, tasks 2.1 and 2.2): server-computed hash,
// guarded writes on state, version and attempt, step-aware Try again, and no simulated advancing of a
// step that waits for an outside system.
import { describe, expect, it } from "vitest";
import { sha256Bytes } from "@/services/gateway-create-input";
import { advanceStep, SIMULATED_OWNERS, type StepDeps } from "@/services/pipeline-step";
import type { WriteEnv } from "@/services/seam-runtime";
import { FakeDb, type Row } from "@/test/fake-db";

const D = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-11-24T10:00:00.000Z";
const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const FILE = bytes("%PDF-1.7 a clean file");

async function world(
  doc: Partial<Row> = {},
  opts: {
    role?: string;
    file?: Uint8Array<ArrayBuffer> | null;
    hash?: string;
    version?: Partial<Row>;
  } = {},
) {
  const hash = opts.hash ?? (await sha256Bytes(FILE));
  const admin = new FakeDb({
    documents: [
      {
        id: D,
        tenant_id: "t1",
        name: "Report.pdf",
        pipeline_state: "uploading",
        pipeline_detail: null,
        current_version_id: V,
        created_by: "u1",
        ...doc,
      },
    ],
    document_versions: [
      {
        id: V,
        document_id: D,
        tenant_id: "t1",
        storage_path: `t1/${V}`,
        content_hash: hash,
        ...opts.version,
      },
    ],
    document_events: [],
  });
  const downloads: string[] = [];
  const deps: StepDeps = {
    download: async (p) => {
      downloads.push(p);
      return opts.file === undefined ? FILE : opts.file;
    },
    now: () => NOW,
    owners: SIMULATED_OWNERS,
  };
  const env = {
    admin: admin.asDb(),
    caller: admin.asDb(),
    userId: "u1",
    tenantId: "t1",
    role: opts.role ?? "contributor",
  } as WriteEnv;
  const row = () => admin.rows("documents")[0]!;
  return { admin, env, deps, downloads, row };
}

describe("advanceStep", () => {
  it("confirms an upload only when the server's hash of the stored file matches", async () => {
    const w = await world();
    const r = await advanceStep(w.env, { id: D }, w.deps);
    expect(r).toEqual({ ok: true, data: { id: D, state: "scanning", retried: false } });
    expect(w.row()).toMatchObject({
      pipeline_state: "scanning",
      pipeline_detail: {
        mode: "simulated",
        step: "scan",
        attempt: 1,
        since: NOW,
        quarantinedVersions: [],
      },
      updated_at: NOW,
    });
    expect(w.admin.rows("document_events")).toMatchObject([
      { action: "pipelineStateChange", detail: "uploading to scanning", version_id: V },
    ]);
  });
  it("refuses a file whose bytes do not match the declared hash, and writes nothing", async () => {
    const w = await world({}, { hash: "sha256:" + "0".repeat(64) });
    const r = await advanceStep(w.env, { id: D }, w.deps);
    expect(!r.ok && r.error.code).toBe("pipeline.hashMismatch");
    expect(w.admin.writesTo("documents")).toEqual([]);
  });
  it("waits for the file before checking starts", async () => {
    const w = await world({}, { file: null });
    const r = await advanceStep(w.env, { id: D }, w.deps);
    expect(!r.ok && r.error.code).toBe("pipeline.notUploaded");
    expect(w.admin.writesTo("documents")).toEqual([]);
  });
  it.each([
    ["a clean scan", "scanning", "%PDF clean", "reading", { step: "read", attempt: 2 }],
    [
      "an infected scan",
      "scanning",
      "TEST-QUARANTINE",
      "quarantined",
      { reason: "threat", quarantinedVersions: [V] },
    ],
    ["a reading", "reading", "%PDF clean", "ready", { attempt: 1 }],
    [
      "an unreadable file",
      "reading",
      "TEST-UNREADABLE",
      "failed",
      { reason: "unreadable", step: "read" },
    ],
  ])("simulates %s", async (_n, state, text, next, detail) => {
    const w = await world(
      { pipeline_state: state, pipeline_detail: { mode: "simulated", attempt: 1 } },
      { file: bytes(text) },
    );
    const r = await advanceStep(w.env, { id: D }, w.deps);
    expect(r.ok && r.data.state).toBe(next);
    expect(w.row()["pipeline_detail"]).toMatchObject(detail);
  });
  it("does not advance a step waiting for an outside system, and does not read its file", async () => {
    const w = await world({
      pipeline_state: "scanning",
      pipeline_detail: { mode: "external", byClient: "c1", step: "scan", attempt: 1 },
    });
    const r = await advanceStep(w.env, { id: D }, w.deps);
    expect(r).toEqual({
      ok: true,
      data: { id: D, state: "scanning", retried: false, waiting: true },
    });
    expect(w.admin.writesTo("documents")).toEqual([]);
    expect(w.downloads).toEqual([]);
  });
  it("Try again restarts the step that failed, with a new attempt", async () => {
    const w = await world({
      pipeline_state: "failed",
      pipeline_detail: { step: "scan", reason: "scanError", attempt: 2 },
    });
    const r = await advanceStep(w.env, { id: D, retry: true }, w.deps);
    expect(r.ok && r.data).toEqual({ id: D, state: "scanning", retried: true });
    expect(w.row()["pipeline_detail"]).toMatchObject({ step: "scan", attempt: 3 });
    expect(w.row()["pipeline_detail"]).not.toHaveProperty("reason");
  });
  it("an old reading failure is tried again as a reading", async () => {
    const w = await world({
      pipeline_state: "failed",
      pipeline_detail: { reason: "unreadableAgain" },
    });
    const r = await advanceStep(w.env, { id: D, retry: true }, w.deps);
    expect(r.ok && r.data.state).toBe("reading");
  });
  it.each([
    ["something not failed", { pipeline_state: "ready" }, true, "pipeline.retry.notFailed"],
    [
      "a file that never arrived",
      { pipeline_state: "failed", pipeline_detail: { reason: "noFile" } },
      true,
      "pipeline.notRetryable",
    ],
    [
      "a quarantined version",
      {
        pipeline_state: "failed",
        pipeline_detail: { reason: "scanError", step: "scan", quarantinedVersions: [V] },
      },
      true,
      "pipeline.quarantined",
    ],
    ["a seeded document", { created_by: null }, false, "pipeline.seeded"],
    [
      "an attempt the database cannot compare",
      { pipeline_detail: { attempt: [1] } },
      false,
      "pipeline.badDetail",
    ],
  ])("refuses %s and writes nothing", async (_n, doc, retry, code) => {
    const w = await world(doc);
    const r = await advanceStep(w.env, { id: D, retry }, w.deps);
    expect(!r.ok && r.error.code).toBe(code);
    expect(w.admin.writesTo("documents")).toEqual([]);
  });
  it("needs edit rights", async () => {
    const w = await world({}, { role: "viewer" });
    const r = await advanceStep(w.env, { id: D }, w.deps);
    expect(!r.ok && r.error.code).toBe("access.roleTooLow");
    expect(w.admin.writesTo("documents")).toEqual([]);
  });
  it.each([
    ["another document", { document_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    ["another tenant", { tenant_id: "t2" }],
  ])("never reads a version of %s", async (_n, version) => {
    const w = await world({}, { version });
    const r = await advanceStep(w.env, { id: D }, w.deps);
    expect(!r.ok && r.error.code).toBe("pipeline.notUploaded");
    expect(w.downloads).toEqual([]);
  });
  it("two steps racing: the one that read an older attempt changes nothing", async () => {
    const w = await world({
      pipeline_state: "scanning",
      pipeline_detail: { mode: "simulated", attempt: 2 },
    });
    // A slower call read the row before another one tried again and moved the attempt on.
    w.admin.stubNextSelect("documents", [
      { ...w.row(), pipeline_detail: { mode: "simulated", attempt: 1 } },
    ]);
    const r = await advanceStep(w.env, { id: D }, w.deps);
    expect(!r.ok && r.error.code).toBe("pipeline.changed");
    expect(w.row()).toMatchObject({ pipeline_state: "scanning", pipeline_detail: { attempt: 2 } });
    expect(w.admin.rows("document_events")).toEqual([]);
  });
  it("guards on a missing attempt as missing, so an older row still moves once", async () => {
    const w = await world({ pipeline_state: "scanning", pipeline_detail: null });
    const r = await advanceStep(w.env, { id: D }, w.deps);
    expect(r.ok && r.data.state).toBe("reading");
  });
  it("leaves finished documents alone without writing", async () => {
    const w = await world({ pipeline_state: "ready" });
    expect(await advanceStep(w.env, { id: D }, w.deps)).toEqual({
      ok: true,
      data: { id: D, state: "ready", retried: false },
    });
    expect(w.admin.writesTo("documents")).toEqual([]);
  });
});
