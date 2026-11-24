// The scheduled timeout of file-hook steps (file-hooks spec R4.7, D8): boundaries, what never
// times out, the guard, tenants, and the activity record.
import { afterEach, describe, expect, it, vi } from "vitest";
import { timeOutWaitingSteps, TIMEOUT_BATCH } from "@/services/file-hook-sweep";
import {
  EXTERNAL_RESULT_TIMEOUT_MINUTES,
  UPLOAD_CONFIRM_TIMEOUT_HOURS,
} from "@/services/file-hook-timeouts";
import { runMaintenance } from "@/services/maintenance";
import { FakeDb, type Row } from "@/test/fake-db";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;
const D = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const external = (over: Row = {}) => ({
  mode: "external",
  by: "Acme AV",
  byClient: "client-av",
  step: "scan",
  attempt: 1,
  since: ago(EXTERNAL_RESULT_TIMEOUT_MINUTES * MIN + 1),
  ...over,
});

function world(doc: Row = {}, version: Row = {}) {
  const id = (doc["id"] as string | undefined) ?? D;
  const vid = (doc["current_version_id"] as string | undefined) ?? V;
  return new FakeDb({
    documents: [
      {
        id,
        tenant_id: "t1",
        pipeline_state: "scanning",
        pipeline_detail: external(),
        current_version_id: vid,
        updated_at: ago(2 * HOUR),
        created_by: "u1",
        registered_by_client: null,
        deleted_at: null,
        purged_at: null,
        ...doc,
      },
    ],
    document_versions: [
      { id: vid, document_id: id, tenant_id: "t1", created_at: ago(HOUR), ...version },
    ],
    document_events: [],
  });
}
const sweep = (db: FakeDb) => timeOutWaitingSteps(db.asDb(), NOW);
const row = (db: FakeDb) => db.rows("documents")[0]!;

afterEach(() => vi.restoreAllMocks());

describe("a step waiting for an outside system", () => {
  it.each([
    ["scanning", "scan"],
    ["reading", "read"],
  ])("fails after the timeout while %s, with that step and noResult", async (state, step) => {
    const db = world({ pipeline_state: state, pipeline_detail: external({ step }) });
    expect(await sweep(db)).toBe(1);
    expect(row(db)).toMatchObject({
      pipeline_state: "failed",
      pipeline_detail: { reason: "noResult", step, attempt: 1 },
      updated_at: NOW.toISOString(),
    });
    expect(db.rows("document_events")).toEqual([
      expect.objectContaining({
        tenant_id: "t1",
        document_id: D,
        version_id: V,
        actor: null,
        action: "pipelineStateChange",
        detail: `${state} to failed (no answer in time)`,
      }),
    ]);
  });
  it("waits at exactly the timeout, fails one millisecond later", async () => {
    const at = world({
      pipeline_detail: external({ since: ago(EXTERNAL_RESULT_TIMEOUT_MINUTES * MIN) }),
    });
    expect(await sweep(at)).toBe(0);
    expect(row(at)["pipeline_state"]).toBe("scanning");
    expect(at.writesTo("documents")).toEqual([]);
    expect(await sweep(world())).toBe(1);
  });
  it("still fails when the system's key was disconnected mid-step (no key is read)", async () => {
    const db = world();
    db.tables["integration_clients"] = [
      { id: "client-av", tenant_id: "t1", scopes: ["scan"], revoked_at: ago(MIN) },
    ];
    expect(await sweep(db)).toBe(1);
  });
  it("with no start time counts from the document's last change", async () => {
    const db = world({
      pipeline_detail: external({ since: undefined }),
      updated_at: ago(EXTERNAL_RESULT_TIMEOUT_MINUTES * MIN + 1),
    });
    expect(await sweep(db)).toBe(1);
    const fresh = world({ pipeline_detail: external({ since: undefined }), updated_at: ago(MIN) });
    expect(await sweep(fresh)).toBe(0);
  });
  it("is never moved to clean or ready, and a simulated step never times out", async () => {
    const db = world({
      pipeline_detail: { mode: "simulated", step: "scan", attempt: 1, since: ago(9 * HOUR) },
    });
    expect(await sweep(db)).toBe(0);
    expect(row(db)["pipeline_state"]).toBe("scanning");
  });
});

describe("an upload never confirmed", () => {
  it("fails after the timeout from when its version was created, with noFile", async () => {
    const db = world(
      { pipeline_state: "uploading", pipeline_detail: null },
      { created_at: ago(UPLOAD_CONFIRM_TIMEOUT_HOURS * HOUR + 1) },
    );
    expect(await sweep(db)).toBe(1);
    expect(row(db)).toMatchObject({
      pipeline_state: "failed",
      pipeline_detail: { reason: "noFile" },
    });
    expect(String(db.rows("document_events")[0]!["detail"])).toBe(
      "uploading to failed (no answer in time)",
    );
  });
  it("waits at exactly the timeout", async () => {
    const db = world(
      { pipeline_state: "uploading", pipeline_detail: null },
      { created_at: ago(UPLOAD_CONFIRM_TIMEOUT_HOURS * HOUR) },
    );
    expect(await sweep(db)).toBe(0);
  });
  it("uses its own version's time, never a version of another document", async () => {
    const db = world(
      { pipeline_state: "uploading", pipeline_detail: null },
      { document_id: "someone-else", created_at: ago(99 * HOUR) },
    );
    expect(await sweep(db)).toBe(0);
    expect(row(db)["pipeline_state"]).toBe("uploading");
  });
});

describe("never moved", () => {
  it.each([
    ["a seeded document", { created_by: null, registered_by_client: null }],
    ["a deleted document", { deleted_at: ago(HOUR) }],
    ["a purged document", { purged_at: ago(HOUR) }],
    ["a ready document", { pipeline_state: "ready" }],
    ["a quarantined document", { pipeline_state: "quarantined" }],
    ["a failed document", { pipeline_state: "failed" }],
    ["a document with no current version", { current_version_id: null }],
  ])("%s", async (_n, over) => {
    const db = world(over);
    expect(await sweep(db)).toBe(0);
    expect(db.writesTo("documents")).toEqual([]);
    expect(db.rows("document_events")).toEqual([]);
  });
  it("a document registered by a system (no person) does time out", async () => {
    expect(await sweep(world({ created_by: null, registered_by_client: "client-1" }))).toBe(1);
  });
  it("a document that moved meanwhile is not overwritten (guarded write)", async () => {
    const db = world(
      { pipeline_state: "uploading", pipeline_detail: null },
      { created_at: ago(UPLOAD_CONFIRM_TIMEOUT_HOURS * HOUR + 1) },
    );
    // The sweep reads the upload as it was; its upload is confirmed before the write.
    db.stubNextSelect("documents", [{ ...row(db) }]);
    row(db)["pipeline_state"] = "scanning";
    row(db)["pipeline_detail"] = external({ attempt: 1, since: NOW.toISOString() });
    expect(await sweep(db)).toBe(0);
    expect(row(db)["pipeline_state"]).toBe("scanning");
    expect(db.writesTo("documents")).toHaveLength(1);
    expect(db.rows("document_events")).toEqual([]);
  });
});

describe("two runs at once", () => {
  it("record a timed-out upload once (the write is guarded on the state too)", async () => {
    const db = world(
      { pipeline_state: "uploading", pipeline_detail: null },
      { created_at: ago(UPLOAD_CONFIRM_TIMEOUT_HOURS * HOUR + 1) },
    );
    db.stubNextSelect("documents", [{ ...row(db) }]);
    // The other run already failed it; its detail has no attempt, like the upload's.
    row(db)["pipeline_state"] = "failed";
    row(db)["pipeline_detail"] = { reason: "noFile" };
    expect(await sweep(db)).toBe(0);
    expect(db.rows("document_events")).toEqual([]);
  });
});

describe("the run", () => {
  it("handles every tenant, each on its own row", async () => {
    const db = world();
    const other = {
      ...row(db),
      id: "33333333-3333-4333-8333-333333333333",
      tenant_id: "t2",
      current_version_id: "44444444-4444-4444-8444-444444444444",
    };
    db.rows("documents").push(other);
    db.rows("document_versions").push({
      id: "44444444-4444-4444-8444-444444444444",
      document_id: "33333333-3333-4333-8333-333333333333",
      tenant_id: "t2",
      created_at: ago(HOUR),
    });
    expect(await sweep(db)).toBe(2);
    expect(
      db
        .rows("document_events")
        .map((e) => e["tenant_id"])
        .sort(),
    ).toEqual(["t1", "t2"]);
  });
  it("looks at a bounded batch of each kind", () => {
    expect(TIMEOUT_BATCH).toBeLessThanOrEqual(500);
  });
  it("a failed record is reported loudly and fails the step of the scheduled run", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m: unknown) => void logged.push(String(m)));
    const db = world().fail("document_events", "insert");
    db.tables["idempotency_keys"] = [];
    db.tables["integration_tokens"] = [];
    const res = await runMaintenance(db.asDb(), NOW);
    expect(res.failed).toContain("stepTimeouts");
    expect(logged.join("\n")).toContain("stepTimeoutEvents");
  });
  it("the scheduled run reports how many steps failed", async () => {
    const db = world();
    db.tables["idempotency_keys"] = [];
    db.tables["integration_tokens"] = [];
    const res = await runMaintenance(db.asDb(), NOW);
    expect(res).toMatchObject({ timedOutSteps: 1 });
    expect(res.failed).not.toContain("stepTimeouts");
  });
});
