// Final QA pass: the timeout sweep (R4.7) racing with a late result, with Try again and with a new
// version. Each race lands in the window between the sweep's read and its guarded write: the
// version lookup is the last read the sweep makes, so the mutation runs there.
// `it.fails` = asserts the correct behaviour and fails today (defect named above it).
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { addVersionStep } from "@/services/document-add-version";
import { timeOutWaitingSteps } from "@/services/file-hook-sweep";
import { downloadDecision } from "@/services/file-hook-download";
import { stepTransition } from "@/services/file-hook-rules";
import {
  EXTERNAL_RESULT_TIMEOUT_MINUTES as N,
  UPLOAD_CONFIRM_TIMEOUT_HOURS,
} from "@/services/file-hook-timeouts";
import { keepUnread } from "@/services/file-hook-versions";
import { advanceStep, type StepDeps } from "@/services/pipeline-step";
import type { WriteEnv } from "@/services/seam-runtime";
import { FakeDb, type Row } from "@/test/fake-db";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const D = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";

const waiting = (over: Row = {}) => ({
  mode: "external",
  by: "Acme AV",
  byClient: "client-av",
  step: "scan",
  attempt: 1,
  since: ago(N * MIN + 1),
  ...over,
});
function world(doc: Row = {}) {
  return new FakeDb({
    documents: [
      {
        id: D,
        tenant_id: "t1",
        name: "Report.pdf",
        pipeline_state: "scanning",
        pipeline_detail: waiting(),
        current_version_id: V,
        updated_at: ago(2 * HOUR),
        created_by: "u1",
        registered_by_client: null,
        deleted_at: null,
        purged_at: null,
        ...doc,
      },
    ],
    document_versions: [{ id: V, document_id: D, tenant_id: "t1", created_at: ago(3 * HOUR) }],
    document_events: [],
  });
}
const doc = (db: FakeDb) => db.rows("documents")[0]!;
const sweep = (db: FakeDb, at = NOW) => timeOutWaitingSteps(db.asDb(), at);

/** Runs `change` once, after the sweep chose its candidates and before it writes. */
function raceWith(db: FakeDb, change: () => void) {
  const real = db.from.bind(db);
  let fired = false;
  db.from = (table: string) => {
    if (table === "document_versions" && !fired) {
      fired = true;
      change();
    }
    return real(table);
  };
}

describe("sweep vs a result that lands mid-sweep (R4.7, R2.9)", () => {
  it("a clean result moved the document to reading: the sweep writes nothing and records nothing", async () => {
    const db = world();
    raceWith(db, () =>
      Object.assign(doc(db), {
        pipeline_state: "reading",
        pipeline_detail: waiting({ step: "read", attempt: 2, since: NOW.toISOString() }),
      }),
    );
    expect(await sweep(db)).toBe(0);
    expect(doc(db)).toMatchObject({
      pipeline_state: "reading",
      pipeline_detail: { attempt: 2, step: "read" },
    });
    expect(db.rows("document_events")).toEqual([]);
  });

  it("a scanner error landed first: its reason scanError is not overwritten with noResult", async () => {
    const db = world();
    raceWith(db, () =>
      Object.assign(doc(db), {
        pipeline_state: "failed",
        pipeline_detail: waiting({ reason: "scanError" }),
      }),
    );
    expect(await sweep(db)).toBe(0);
    expect(doc(db)["pipeline_detail"]).toMatchObject({ reason: "scanError" });
  });

  it("an infected result landed first: the quarantine is not overwritten by a timeout failure", async () => {
    const db = world();
    raceWith(db, () =>
      Object.assign(doc(db), {
        pipeline_state: "quarantined",
        pipeline_detail: waiting({ reason: "threat", quarantinedVersions: [V] }),
      }),
    );
    expect(await sweep(db)).toBe(0);
    expect(doc(db)).toMatchObject({ pipeline_state: "quarantined" });
  });

  it("two sweeps at once: exactly one moves the document and exactly one event is written", async () => {
    const db = world();
    const [a, b] = await Promise.all([sweep(db), sweep(db)]);
    expect([a, b].sort()).toEqual([0, 1]);
    expect(db.rows("document_events")).toHaveLength(1);
    expect(doc(db)["pipeline_state"]).toBe("failed");
  });
});

describe("sweep vs Try again (R4.4, R4.7)", () => {
  it("Try again landed after a peer sweep failed the step: the stale sweep leaves attempt 2 alone (attempt guard)", async () => {
    // State and version are the same as the sweep read; only the attempt differs.
    const db = world();
    raceWith(db, () =>
      Object.assign(doc(db), {
        pipeline_detail: waiting({ attempt: 2, since: NOW.toISOString() }),
      }),
    );
    expect(await sweep(db)).toBe(0);
    expect(doc(db)["pipeline_state"]).toBe("scanning");
    expect(doc(db)["pipeline_detail"]).toMatchObject({ attempt: 2, since: NOW.toISOString() });
  });

  it("a legacy detail with no attempt: Try again wrote attempt 1, the sweep (read as null) writes nothing", async () => {
    const db = world({ pipeline_detail: { mode: "external", since: ago(N * MIN + 1) } });
    raceWith(db, () =>
      Object.assign(doc(db), {
        pipeline_detail: { mode: "external", step: "scan", attempt: 1, since: NOW.toISOString() },
      }),
    );
    expect(await sweep(db)).toBe(0);
    expect(doc(db)["pipeline_detail"]).toMatchObject({ attempt: 1 });
  });

  describe("with the real Try again", () => {
    const owners = async () => ({
      scan: { mode: "external" as const, by: "Acme AV", byClient: "client-av" },
      read: { mode: "external" as const, by: "Acme OCR", byClient: "client-ocr" },
    });
    const retry = (db: FakeDb, at: Date) =>
      advanceStep(
        {
          admin: db.asDb(),
          caller: db.asDb(),
          userId: "u1",
          tenantId: "t1",
          role: "contributor",
        } as WriteEnv,
        { id: D, retry: true },
        { download: async () => null, now: () => at.toISOString(), owners } as StepDeps,
      );

    it("the wait starts again at Try again: not failed again at once, failed again N minutes later", async () => {
      const db = world();
      expect(await sweep(db)).toBe(1);
      expect((await retry(db, NOW)).ok).toBe(true);
      expect(doc(db)).toMatchObject({
        pipeline_state: "scanning",
        pipeline_detail: { attempt: 2 },
      });
      expect(await sweep(db, NOW)).toBe(0);
      expect(await sweep(db, new Date(NOW.getTime() + (N - 1) * MIN))).toBe(0);
      expect(await sweep(db, new Date(NOW.getTime() + N * MIN + 1))).toBe(1);
      expect(doc(db)["pipeline_detail"]).toMatchObject({ reason: "noResult", attempt: 2 });
    });

    it("two Try again clicks at once restart the step once", async () => {
      const db = world();
      await sweep(db);
      const [a, b] = await Promise.all([retry(db, NOW), retry(db, NOW)]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      expect(doc(db)["pipeline_detail"]).toMatchObject({ attempt: 2 });
    });

    it("a late answer for attempt 1 after Try again is stale, and one for the failed step is refused", () => {
      const failedDetail = { ...waiting(), reason: "noResult" };
      const late = {
        kind: "scanResult" as const,
        result: "clean" as const,
        from: { clientId: "client-av", versionId: V, attempt: 1 },
      };
      const ctx = {
        now: NOW.toISOString(),
        versionId: V,
        owner: { scan: { mode: "simulated" as const }, read: { mode: "simulated" as const } },
      };
      expect(stepTransition("failed", failedDetail, late, ctx)).toMatchObject({
        ok: false,
        code: "wrongState",
      });
      expect(stepTransition("scanning", waiting({ attempt: 2 }), late, ctx)).toMatchObject({
        ok: false,
        code: "staleAttempt",
      });
    });
  });
});

describe("after the timeout nothing becomes clean or ready (R4.7)", () => {
  const owner = { scan: { mode: "simulated" as const }, read: { mode: "simulated" as const } };
  const from = (attempt: number) => ({ clientId: "client-av", versionId: V, attempt });
  it.each(["clean", "infected", "error"] as const)(
    "a late scanner answer %s after a noResult scan is refused (wrongState), the file stays locked",
    async (result) => {
      const db = world();
      await sweep(db);
      const failed = doc(db);
      const out = stepTransition(
        failed["pipeline_state"] as "failed",
        failed["pipeline_detail"],
        { kind: "scanResult", result, from: from(1) },
        { now: NOW.toISOString(), versionId: V, owner },
      );
      expect(out).toMatchObject({ ok: false, code: "wrongState" });
      const state = {
        pipelineState: "failed" as const,
        pipelineDetail: failed["pipeline_detail"],
        currentVersionId: V,
      };
      expect(downloadDecision({ kind: "person" }, state, V)).toMatchObject({
        ok: false,
        code: "contentLocked",
      });
      expect(downloadDecision({ kind: "scanner", clientId: "client-av" }, state, V)).toMatchObject({
        ok: false,
      });
      expect(keepUnread("failed", failed["pipeline_detail"], V)).toMatchObject({
        ok: false,
        code: "notReadingFailure",
      });
    },
  );

  it("a late reader answer after a noResult read is refused; Keep without reading is then the person's choice", async () => {
    const db = world({
      pipeline_state: "reading",
      pipeline_detail: waiting({ step: "read", byClient: "client-ocr" }),
    });
    await sweep(db);
    const failed = doc(db);
    expect(failed["pipeline_detail"]).toMatchObject({ reason: "noResult", step: "read" });
    const out = stepTransition(
      "failed",
      failed["pipeline_detail"],
      {
        kind: "readResult",
        result: "read",
        from: { clientId: "client-ocr", versionId: V, attempt: 1 },
      },
      { now: NOW.toISOString(), versionId: V, owner },
    );
    expect(out).toMatchObject({ ok: false, code: "wrongState" });
    expect(keepUnread("failed", failed["pipeline_detail"], V).ok).toBe(true);
  });
});

describe("sweep vs adding a version (R4.8, D5)", () => {
  it("a new version landed on an old upload: the stale sweep does not fail the new upload (version guard)", async () => {
    const db = world({
      pipeline_state: "uploading",
      pipeline_detail: { attempt: 1, quarantinedVersions: [] },
      updated_at: ago(UPLOAD_CONFIRM_TIMEOUT_HOURS * HOUR + 60_000),
    });
    db.rows("document_versions")[0]!["created_at"] = ago(
      UPLOAD_CONFIRM_TIMEOUT_HOURS * HOUR + 60_000,
    );
    raceWith(db, () =>
      Object.assign(doc(db), {
        current_version_id: V2,
        updated_at: NOW.toISOString(),
      }),
    );
    expect(await sweep(db)).toBe(0);
    expect(doc(db)).toMatchObject({ pipeline_state: "uploading", current_version_id: V2 });
    expect(db.rows("document_events")).toEqual([]);
  });

  it("the new version was already confirmed (scanning, attempt 2): the stale sweep leaves it alone", async () => {
    const db = world();
    raceWith(db, () =>
      Object.assign(doc(db), {
        current_version_id: V2,
        pipeline_state: "scanning",
        pipeline_detail: waiting({ attempt: 2, since: NOW.toISOString() }),
      }),
    );
    expect(await sweep(db)).toBe(0);
    expect(doc(db)).toMatchObject({ current_version_id: V2, pipeline_detail: { attempt: 2 } });
  });

  it("only the version guard holds: same state, same attempt, other version, is not failed", async () => {
    const db = world();
    raceWith(db, () => Object.assign(doc(db), { current_version_id: V2 }));
    expect(await sweep(db)).toBe(0);
    expect(doc(db)["pipeline_state"]).toBe("scanning");
  });

  it("the real addVersionStep on a waiting step: the document restarts at uploading and the sweep leaves it", async () => {
    const db = world({ status: "draft" });
    db.rows("documents")[0]!["updated_at"] = ago(2 * HOUR);
    const env = {
      admin: db.asDb(),
      caller: db.asDb(),
      userId: "u1",
      tenantId: "t1",
      role: "contributor",
    } as WriteEnv;
    const added = await addVersionStep(env, {
      id: D,
      mimeType: "application/pdf",
      size: 10,
      contentHash: `sha256:${"a".repeat(64)}`,
    });
    expect(added.ok).toBe(true);
    expect(doc(db)).toMatchObject({ pipeline_state: "uploading" });
    expect(doc(db)["pipeline_detail"]).toEqual({ attempt: 1, quarantinedVersions: [] });
    // Shortly after the new version, long after the old step started: the old wait is gone.
    expect(await sweep(db, new Date(Date.now() + MIN))).toBe(0);
    expect(doc(db)["pipeline_state"]).toBe("uploading");
  });

  it("an old upload that gets a new version this minute is not failed for the old upload's age", async () => {
    const db = world({
      pipeline_state: "uploading",
      pipeline_detail: { attempt: 1, quarantinedVersions: [] },
      // Old row, but the new version is fresh: the candidate query passes it, the version time must stop it.
      updated_at: ago(UPLOAD_CONFIRM_TIMEOUT_HOURS * HOUR + 60_000),
    });
    db.rows("document_versions")[0]!["created_at"] = ago(MIN);
    expect(await sweep(db)).toBe(0);
    expect(doc(db)["pipeline_state"]).toBe("uploading");
  });
});

describe("sweep boundaries that decide whether a document is failed", () => {
  it("exactly N minutes is not yet; one millisecond more is", async () => {
    const exact = world({ pipeline_detail: waiting({ since: ago(N * MIN) }) });
    expect(await sweep(exact)).toBe(0);
    const over = world({ pipeline_detail: waiting({ since: ago(N * MIN + 1) }) });
    expect(await sweep(over)).toBe(1);
  });

  it("an unreadable start time counts from the last change; a change after the start does not hide a late step", async () => {
    const db = world({
      pipeline_detail: waiting({ since: "garbage" }),
      updated_at: ago(N * MIN + 5),
    });
    expect(await sweep(db)).toBe(1);
  });

  it("a renamed document (updated_at fresh) whose step started long ago still fails", async () => {
    const db = world({ updated_at: ago(MIN) });
    expect(await sweep(db)).toBe(1);
  });

  it("a simulated step is never failed, however old", async () => {
    const db = world({
      pipeline_detail: { mode: "simulated", attempt: 1, since: ago(10 * HOUR) },
      updated_at: ago(10 * HOUR),
    });
    expect(await sweep(db)).toBe(0);
    expect(doc(db)["pipeline_state"]).toBe("scanning");
  });

  it("a seeded document (no person, no system) is never moved", async () => {
    const db = world({ created_by: null, registered_by_client: null });
    expect(await sweep(db)).toBe(0);
  });

  it("a version that belongs to another document gives no time: no move (R6.1)", async () => {
    const db = world();
    db.rows("document_versions")[0]!["document_id"] = "99999999-9999-4999-8999-999999999999";
    expect(await sweep(db)).toBe(0);
  });

  it("a failed insert of the activity record still reports the move that was made (log names the id)", async () => {
    const db = world();
    db.fail("document_events", "insert");
    const logged: string[] = [];
    const spy = console.error;
    console.error = (m: unknown) => void logged.push(String(m));
    try {
      await expect(sweep(db)).rejects.toThrow();
    } finally {
      console.error = spy;
    }
    expect(doc(db)["pipeline_state"]).toBe("failed");
    expect(logged.join("\n")).toContain(D);
  });
});
