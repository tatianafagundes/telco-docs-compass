// QA adversarial pass on the server pipeline (phase 2): advanceStep, addVersionStep, Keep without
// reading, and the FakeDb behaviours those tests lean on. `it.fails` = asserts the correct behaviour,
// fails today (defect named in the comment above it).
// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { addVersionStep } from "@/services/document-add-version";
import { updateDocumentIf } from "@/services/document-update";
import type { Step } from "@/services/file-hook-detail";
import type { StepOwner } from "@/services/file-hook-rules";
import { keepUnread } from "@/services/file-hook-versions";
import { sha256Bytes } from "@/services/gateway-create-input";
import { advanceStep, SIMULATED_OWNERS, type StepDeps } from "@/services/pipeline-step";
import type { Db, WriteEnv } from "@/services/seam-runtime";
import { FakeDb, type Row } from "@/test/fake-db";

const D = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const V3 = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-11-24T10:00:00.000Z";
const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const FILE = bytes("%PDF-1.7 a clean file");

async function world(
  doc: Partial<Row> = {},
  opts: {
    role?: string;
    file?: Uint8Array<ArrayBuffer> | null | "tooLarge";
    version?: Partial<Row>;
    owners?: () => Promise<Record<Step, StepOwner>>;
    onDownload?: (db: FakeDb) => void;
  } = {},
) {
  const hash = `sha256:${await sha256Bytes(opts.file instanceof Uint8Array ? opts.file : FILE)}`;
  const file = opts.file === undefined ? FILE : opts.file;
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
        deleted_at: null,
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
        size_bytes: FILE.byteLength,
        ...opts.version,
      },
    ],
    document_events: [],
  });
  const deps: StepDeps = {
    download: async () => {
      opts.onDownload?.(admin);
      return file;
    },
    now: () => NOW,
    owners: opts.owners ?? SIMULATED_OWNERS,
  };
  const env = {
    admin: admin.asDb(),
    caller: admin.asDb(),
    userId: "u1",
    tenantId: "t1",
    role: opts.role ?? "contributor",
  } as WriteEnv;
  const row = () => admin.rows("documents")[0]!;
  const go = (retry?: boolean) => advanceStep(env, { id: D, retry }, deps);
  return { admin, env, deps, row, go };
}
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "ok" : r.error?.code);

// ---------------------------------------------------------------------------------------------
describe("QA advanceStep: lifecycle and races", () => {
  it("walks uploading -> scanning -> reading -> ready, counting attempts 1, 2, and writes once per step", async () => {
    const w = await world();
    const seen: [string, unknown][] = [];
    for (let i = 0; i < 4; i++) {
      const r = await w.go();
      expect(r.ok).toBe(true);
      seen.push([
        w.row()["pipeline_state"] as string,
        (w.row()["pipeline_detail"] as Row | null)?.["attempt"],
      ]);
    }
    expect(seen).toEqual([
      ["scanning", 1],
      ["reading", 2],
      ["ready", 2],
      ["ready", 2],
    ]);
    expect(w.admin.writesTo("documents")).toHaveLength(3); // the 4th call (ready) wrote nothing
    expect(w.admin.writesTo("document_events")).toHaveLength(3);
  });
  it("two browsers advancing the same document at once: writes and attempt stay in step", async () => {
    const w = await world();
    const [a, b] = await Promise.all([w.go(), w.go()]);
    const state = w.row()["pipeline_state"];
    const attempt = (w.row()["pipeline_detail"] as Row)["attempt"] as number;
    // Either one lost the guard (conflict), or they ran back to back: never a skipped or repeated attempt.
    // FakeDb logs a guarded update that matched nothing as a write with no rows: count only real ones.
    expect(w.admin.writesTo("documents").filter((x) => x.rows.length > 0)).toHaveLength(attempt);
    expect(state).toBe(attempt === 1 ? "scanning" : attempt === 2 ? "reading" : "?");
    for (const r of [a, b]) expect(["ok", "pipeline.changed"]).toContain(code(r));
  });
  // Each guard column on its own: something else changes the row after it was read and before the write.
  const mutations: [string, (db: FakeDb) => void][] = [
    ["state", (db) => void (db.rows("documents")[0]!["pipeline_state"] = "failed")],
    ["current version", (db) => void (db.rows("documents")[0]!["current_version_id"] = V2)],
    ["attempt", (db) => void (db.rows("documents")[0]!["pipeline_detail"] = { attempt: 7 })],
    [
      "attempt as text",
      (db) => void (db.rows("documents")[0]!["pipeline_detail"] = { attempt: "0" }),
    ],
  ];
  for (const [name, mutate] of mutations)
    it(`a ${name} change between read and write is a conflict and is not overwritten`, async () => {
      let fired = false;
      const w = await world(
        {},
        {
          onDownload: (db) => {
            if (!fired) {
              fired = true;
              mutate(db);
            }
          },
        },
      );
      const r = await w.go();
      expect(code(r)).toBe("pipeline.changed");
      expect(w.admin.writesTo("document_events")).toEqual([]);
      expect(w.row()["pipeline_state"]).not.toBe("scanning");
    });
  it("a version that belongs to another document, another tenant, or does not exist is never processed", async () => {
    for (const v of [
      { document_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { tenant_id: "t2" },
    ]) {
      const w = await world({}, { version: v });
      expect(code(await w.go()), JSON.stringify(v)).toBe("pipeline.notUploaded");
      expect(w.admin.writesTo("documents")).toEqual([]);
    }
    const none = await world({ current_version_id: null });
    expect(code(await none.go())).toBe("pipeline.notUploaded");
    const dangling = await world({ current_version_id: V3 });
    expect(code(await dangling.go())).toBe("pipeline.notUploaded");
  });
  it("who may advance: viewers no, editors yes; another tenant's, deleted and seeded documents never", async () => {
    expect(code(await (await world({}, { role: "viewer" })).go())).toBe("access.roleTooLow");
    expect(code(await (await world({ tenant_id: "t2" })).go())).toBe("doc.notFound");
    expect(code(await (await world({ deleted_at: NOW })).go())).toBe("doc.notFound");
    expect(code(await (await world({ created_by: null, registered_by_client: null })).go())).toBe(
      "pipeline.seeded",
    );
    expect(code(await (await world({ created_by: null, registered_by_client: "c1" })).go())).toBe(
      "ok",
    );
  });
  it("the stored file decides: hash, size and size limit", async () => {
    const hex = await sha256Bytes(FILE);
    expect(code(await (await world({}, { version: { content_hash: hex } })).go())).toBe("ok");
    expect(
      code(
        await (await world({}, { version: { content_hash: `SHA256:${hex.toUpperCase()}` } })).go(),
      ),
    ).toBe("ok");
    expect(code(await (await world({}, { version: { size_bytes: null } })).go())).toBe("ok");
    for (const [why, version] of [
      ["empty hash", { content_hash: "" }],
      ["short hash", { content_hash: `sha256:${hex.slice(1)}` }],
      ["other hash", { content_hash: `sha256:${"0".repeat(64)}` }],
    ] as const)
      expect(code(await (await world({}, { version })).go()), why).toBe("pipeline.hashMismatch");
    expect(
      code(await (await world({}, { version: { size_bytes: FILE.byteLength + 1 } })).go()),
    ).toBe("pipeline.sizeMismatch");
    expect(code(await (await world({}, { file: "tooLarge" })).go())).toBe("pipeline.tooLarge");
    expect(code(await (await world({}, { file: null })).go())).toBe("pipeline.notUploaded");
    expect(code(await (await world({}, { version: { storage_path: null } })).go())).toBe(
      "pipeline.notUploaded",
    );
  });
});

describe("QA advanceStep: external steps and Try again", () => {
  const external = async (): Promise<Record<Step, StepOwner>> => ({
    scan: { mode: "external", by: "Acme\u202E AV", byClient: "c1" },
    read: { mode: "external", by: "Acme OCR", byClient: "c2" },
  });
  it("a confirmed upload waits for the outside scanner: flagged, system name cleaned, and later calls write nothing", async () => {
    const w = await world({}, { owners: external });
    expect(await w.go()).toMatchObject({ ok: true, data: { state: "scanning", waiting: true } });
    expect(w.row()["pipeline_detail"]).toMatchObject({
      mode: "external",
      by: "Acme\uFFFD AV",
      byClient: "c1",
      step: "scan",
      attempt: 1,
    });
    const writes = w.admin.writes.length;
    for (let i = 0; i < 3; i++)
      expect(await w.go()).toMatchObject({ ok: true, data: { state: "scanning", waiting: true } });
    expect(w.admin.writes.length).toBe(writes);
  });
  it("Try again is refused unless the document failed, and never past a waiting step", async () => {
    const w = await world({}, { owners: external });
    await w.go();
    expect(code(await w.go(true))).toBe("pipeline.retry.notFailed");
    for (const state of ["ready", "quarantined", "uploading", "reading"])
      expect(code(await (await world({ pipeline_state: state })).go(true)), state).toBe(
        "pipeline.retry.notFailed",
      );
  });
  it("Try again after a timed-out external scan starts a NEW attempt of the scan under the owner decided now", async () => {
    const w = await world(
      {
        pipeline_state: "failed",
        pipeline_detail: {
          mode: "external",
          byClient: "c0",
          by: "Old",
          step: "scan",
          reason: "noResult",
          attempt: 4,
          since: NOW,
        },
      },
      { owners: external },
    );
    expect(await w.go(true)).toMatchObject({
      ok: true,
      data: { state: "scanning", retried: true, waiting: true },
    });
    expect(w.row()["pipeline_detail"]).toMatchObject({ byClient: "c1", attempt: 5, step: "scan" });
  });
  it("a file that never arrived cannot be retried; an unreadable file keeps failing with a growing attempt", async () => {
    const gone = await world({
      pipeline_state: "failed",
      pipeline_detail: { reason: "noFile", attempt: 1 },
    });
    expect(code(await gone.go(true))).toBe("pipeline.notRetryable");
    const w = await world(
      { name: "TEST.pdf" },
      { file: bytes("TEST-UNREADABLE"), version: { size_bytes: "TEST-UNREADABLE".length } },
    );
    await w.go(); // scanning 1
    await w.go(); // reading 2
    await w.go(); // failed (unreadable)
    expect(w.row()["pipeline_state"]).toBe("failed");
    for (let i = 0; i < 3; i++) {
      expect(await w.go(true)).toMatchObject({ ok: true, data: { state: "reading" } });
      expect((w.row()["pipeline_detail"] as Row)["attempt"]).toBe(3 + i);
      await w.go();
      expect(w.row()["pipeline_state"]).toBe("failed");
    }
  });
  it("a threat blocks the document for good: no retry, no further step, the version stays on the list", async () => {
    const w = await world({ name: "setup.exe" });
    await w.go();
    await w.go();
    expect(w.row()).toMatchObject({
      pipeline_state: "quarantined",
      pipeline_detail: { reason: "threat", step: "scan", quarantinedVersions: [V] },
    });
    const writes = w.admin.writes.length;
    expect(await w.go()).toMatchObject({ ok: true, data: { state: "quarantined" } });
    expect(code(await w.go(true))).toBe("pipeline.retry.notFailed");
    expect(w.admin.writes.length).toBe(writes);
  });
  it("a document with an unguardable attempt is refused, written to nowhere", async () => {
    const w = await world({ pipeline_detail: { attempt: true } });
    expect(code(await w.go())).toBe("pipeline.badDetail");
    expect(w.admin.writesTo("documents")).toEqual([]);
  });
  it("an unknown stored state is answered as is, not moved", async () => {
    const w = await world({ pipeline_state: "mystery" });
    expect(await w.go()).toMatchObject({ ok: true, data: { state: "mystery" } });
    expect(w.admin.writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA addVersionStep", () => {
  const HASH = `sha256:${"a".repeat(64)}`;
  const OTHER = `sha256:${"b".repeat(64)}`;
  function aw(doc: Partial<Row> = {}, versions: Row[] = [], role = "contributor") {
    const admin = new FakeDb({
      documents: [
        {
          id: D,
          tenant_id: "t1",
          status: "draft",
          pipeline_state: "ready",
          pipeline_detail: { attempt: 2 },
          current_version_id: V2,
          ...doc,
        },
      ],
      document_versions: versions.map((v) => ({ document_id: D, tenant_id: "t1", ...v })),
      document_events: [],
    });
    const env = {
      admin: admin.asDb(),
      caller: admin.asDb(),
      userId: "u1",
      tenantId: "t1",
      role,
    } as WriteEnv;
    return { admin, env, doc: () => admin.rows("documents")[0]! };
  }
  const upload = { id: D, mimeType: "application/pdf", size: 10, contentHash: HASH };
  const ver = (id: string, hash: string, path: string | null, label = "1") => ({
    id,
    content_hash: hash,
    storage_path: path,
    label,
    mime_type: "application/pdf",
  });
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  it("the quarantine list at its limit refuses a new version and writes nothing; one below it accepts", async () => {
    const full = aw({ pipeline_detail: { attempt: 1, quarantinedVersions: ids(1000) } });
    const r = await addVersionStep(full.env, upload);
    expect(!r.ok && r.error.code).toBe("doc.version.quarantineFull");
    expect(full.admin.writes).toEqual([]);
    const near = aw({ pipeline_detail: { attempt: 1, quarantinedVersions: ids(999) } });
    expect((await addVersionStep(near.env, upload)).ok).toBe(true);
    expect(
      (near.doc()["pipeline_detail"] as { quarantinedVersions: string[] }).quarantinedVersions,
    ).toHaveLength(999);
  });
  it("a document quarantined before the list existed: the same bytes under another version id stay refused", async () => {
    const w = aw({ pipeline_state: "quarantined", pipeline_detail: { reason: "threat" } }, [
      ver(V2, HASH, "t1/v2", "2"),
      ver(V3, HASH, "t1/other", "3"),
    ]);
    const r = await addVersionStep(w.env, {
      id: D,
      mimeType: "application/pdf",
      restoreFromVersionId: V3,
    });
    expect(!r.ok && r.error.code).toBe("doc.version.quarantined");
    expect(w.admin.writesTo("document_versions")).toEqual([]);
  });
  it("an empty hash or a missing path says nothing about a file: it never matches a quarantined version", async () => {
    const w = aw({ pipeline_detail: { attempt: 1, quarantinedVersions: [V] } }, [
      ver(V, "", null, "1"),
      ver(V3, "", null, "3"),
    ]);
    const r = await addVersionStep(w.env, {
      id: D,
      mimeType: "application/pdf",
      restoreFromVersionId: V3,
    });
    expect(r.ok).toBe(true);
  });
  it("restoring a version of another document or tenant, or one that does not exist, is not found", async () => {
    const w = aw({}, [
      { ...ver(V3, OTHER, "t1/v3", "3"), document_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { ...ver(V, OTHER, "t1/v", "1"), tenant_id: "t2" },
    ]);
    for (const id of [V3, V, "99999999-9999-4999-8999-999999999999"]) {
      const r = await addVersionStep(w.env, {
        id: D,
        mimeType: "application/pdf",
        restoreFromVersionId: id,
      });
      expect(!r.ok && r.error.code, id).toBe("doc.version.notFound");
    }
    expect(w.admin.writes).toEqual([]);
  });
  it("who may add: viewers and the group admin no", async () => {
    for (const role of ["viewer", "master_admin"]) {
      const w = aw({}, [], role);
      expect((await addVersionStep(w.env, upload)).ok, role).toBe(false);
      expect(w.admin.writes, role).toEqual([]);
    }
  });
  it("a document whose attempt cannot be guarded refuses a new version (pinned dead end)", async () => {
    const w = aw({ pipeline_detail: { attempt: 1.5 } });
    const r = await addVersionStep(w.env, upload);
    expect(!r.ok && r.error.code).toBe("doc.version.badDetail");
  });
  // DEFECT (medium, document-add-version.ts:68-74): the lookup that finds "the same file under another
  // version id" ignores its error. When the query fails (here: the request is refused), `blockedVersions`
  // is null, `(null ?? []).some(...)` is false and the restore of an infected file goes through. The
  // check fails OPEN. The rule it protects (D5, BR-155) is a security control; it must refuse (or retry)
  // when it cannot tell.
  it("refuses the restore when the same-file lookup itself fails (fixed: fails closed)", async () => {
    const w = aw({ pipeline_detail: { attempt: 1, quarantinedVersions: [V] } }, [
      ver(V, HASH, "t1/v1", "1"),
      ver(V3, HASH, "t1/copy", "3"), // same bytes as the quarantined one
    ]);
    const db = w.admin as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = db.from.bind(db);
    db.from = (t: string) => {
      const qb = realFrom(t) as { in?: (...a: unknown[]) => unknown; then?: unknown };
      if (t === "document_versions" && qb.in) {
        const realIn = qb.in.bind(qb);
        qb.in = (...a: unknown[]) => {
          realIn(...a);
          qb.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: "414 URI Too Long" } }).then(ok, bad);
          return qb;
        };
      }
      return qb;
    };
    const r = await addVersionStep(w.env, {
      id: D,
      mimeType: "application/pdf",
      restoreFromVersionId: V3,
    });
    expect(r.ok).toBe(false);
  });
  // DEFECT (medium, same lookup): the quarantine list goes into the URL as `id=in.(…)`. At the list's
  // own limit (1000 ids) that is ~38 KB of query string; Supabase's gateway and common proxies refuse
  // requests lines of 8-16 KB. So the lookup starts failing long before the list is "full", and (above)
  // a failing lookup lets the restore through. Measured with the real client.
  it("the same-file lookup stays under a 16 KB request line at the list's limit (fixed: query by file)", async () => {
    const urls: string[] = [];
    const client = createClient("https://db.example.test", "k", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (i: RequestInfo | URL) => {
          const url = String(i instanceof Request ? i.url : i);
          urls.push(url);
          // The version to restore exists; every other lookup answers empty.
          const body = url.includes("id=eq.")
            ? [
                {
                  mime_type: "application/pdf",
                  size_bytes: 1,
                  content_hash: `sha256:${"c".repeat(64)}`,
                  storage_path: "t1/x",
                  sample_pages: null,
                  label: "3",
                },
              ]
            : [];
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    }) as unknown as Db;
    const list = ids(1000);
    const admin = new FakeDb({
      documents: [
        {
          id: D,
          tenant_id: "t1",
          status: "draft",
          pipeline_state: "ready",
          pipeline_detail: { attempt: 1, quarantinedVersions: list.slice(0, 999) },
          current_version_id: V2,
        },
      ],
    });
    const fakeDocs = admin.asDb();
    // documents and counts from the fake; the version lookup through the real client, to see its URL
    const env = {
      admin: new Proxy(fakeDocs, {
        get: (t, p) =>
          p === "from"
            ? (n: string) =>
                n === "document_versions"
                  ? client.from("document_versions")
                  : t.from(n as "documents")
            : Reflect.get(t, p),
      }),
      caller: fakeDocs,
      userId: "u1",
      tenantId: "t1",
      role: "contributor",
    } as unknown as WriteEnv;
    await addVersionStep(env, {
      id: D,
      mimeType: "application/pdf",
      restoreFromVersionId: V3,
    }).catch(() => undefined);
    // The same-file lookup is sent (by stored object or by bytes), and no request line is long.
    expect(
      urls.some((u) => /storage_path=eq\.|content_hash=in\./.test(decodeURIComponent(u))),
    ).toBe(true);
    for (const u of urls) expect(u.length).toBeLessThan(16_384);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA Keep without reading", () => {
  const ok = (state: string, detail: unknown, cur: string | null = V) =>
    keepUnread(state as never, detail, cur);
  it("only a failed READ qualifies: every other state, scan failure, missing file and bad detail is refused", () => {
    for (const s of ["uploading", "scanning", "reading", "ready", "quarantined"])
      expect(ok(s, {})).toMatchObject({ ok: false, code: "notFailed" });
    for (const d of [
      { step: "scan" },
      { reason: "scanError" },
      { reason: "threat" },
      { reason: "noFile" },
      { reason: "noFile", step: "read" },
      { reason: "noResult", step: "scan" },
    ])
      expect(ok("failed", d), JSON.stringify(d)).toMatchObject({
        ok: false,
        code: "notReadingFailure",
      });
    for (const d of [
      {},
      { step: "read" },
      { reason: "unreadable" },
      { reason: "unreadableAgain" },
      { reason: "noResult", step: "read" },
    ])
      expect(ok("failed", d), JSON.stringify(d)).toMatchObject({ ok: true });
    expect(ok("failed", { attempt: true })).toMatchObject({ ok: false, code: "badDetail" });
  });
  it("keeps the attempt and the whole quarantine list, and marks the note", () => {
    const r = ok("failed", {
      step: "read",
      attempt: 6,
      quarantinedVersions: [V2.toUpperCase(), V3],
      by: "x",
      mode: "external",
    });
    expect(r).toMatchObject({
      ok: true,
      detail: { note: "notRead", attempt: 6, quarantinedVersions: [V2, V3] },
    });
    expect(r.ok && Object.keys(r.detail).sort()).toEqual([
      "attempt",
      "note",
      "quarantinedVersions",
    ]);
  });
  // DEFECT (low, defence in depth, file-hook-versions.ts:72): keepUnread never looks at the quarantine
  // list. A failed row whose CURRENT version is listed (not reachable through this code today, but
  // reachable through the legacy rows tasks.md L3/L4 worry about) is turned into `ready`: D5 says a
  // quarantined version can never be made current-and-ready again. Downloads still refuse it, the tag
  // would say Ready.
  it("refuses to mark a listed (quarantined) current version ready (fixed)", () => {
    expect(ok("failed", { step: "read", quarantinedVersions: [V] }, V)).toMatchObject({
      ok: false,
    });
  });
  it("the write guard holds against a new version or a new attempt landing meanwhile (real update path on FakeDb)", async () => {
    for (const attempt of [3, 0, undefined]) {
      const row = {
        id: D,
        tenant_id: "t1",
        pipeline_state: "failed",
        current_version_id: V,
        pipeline_detail: { step: "read", ...(attempt === undefined ? {} : { attempt }) },
      };
      const k = keepUnread("failed", row.pipeline_detail, V);
      if (!k.ok) throw new Error("setup");
      const run = async (mutate?: (r: Row) => void) => {
        const db = new FakeDb({
          documents: [{ ...row, pipeline_detail: { ...row.pipeline_detail } }],
        });
        if (mutate) mutate(db.rows("documents")[0]!);
        return updateDocumentIf(
          db.asDb(),
          { id: D, tenantId: "t1", expect: { ...k.expect } },
          { pipeline_state: "ready" },
          "t",
        );
      };
      expect(await run(), `attempt ${String(attempt)}`).toBe(true);
      expect(await run((r) => (r["current_version_id"] = V2)), "version").toBe(false);
      expect(await run((r) => (r["pipeline_state"] = "reading")), "state").toBe(false);
      expect(
        await run((r) => (r["pipeline_detail"] = { step: "read", attempt: 99 })),
        "attempt",
      ).toBe(false);
    }
  });
  it("a document with no current version is guarded as is-null, so a version added meanwhile blocks it", async () => {
    const k = keepUnread("failed", { step: "read" }, null);
    if (!k.ok) throw new Error("setup");
    const db = new FakeDb({
      documents: [
        {
          id: D,
          tenant_id: "t1",
          pipeline_state: "failed",
          current_version_id: V,
          pipeline_detail: { step: "read" },
        },
      ],
    });
    expect(
      await updateDocumentIf(
        db.asDb(),
        { id: D, tenantId: "t1", expect: { ...k.expect } },
        { pipeline_state: "ready" },
        "t",
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("QA FakeDb: where it can make a test pass for the wrong reason", () => {
  // DIVERGENCE (low, test infrastructure): a guarded update that matches no row is still logged in
  // `writes` (with rows: []). A test that asserts `writesTo("documents")` has length 1 after a lost race
  // passes on a write that never happened; assert on `rows.length` or on the stored row instead.
  it("pinned: a lost guarded update still appears in the write log, with no rows", async () => {
    const w = await world();
    await w.admin
      .from("documents")
      .update({ pipeline_state: "x" })
      .eq("id", D)
      .eq("pipeline_state", "nope");
    expect(w.admin.writesTo("documents")).toHaveLength(1);
    expect(w.admin.writesTo("documents")[0]!.rows).toEqual([]);
  });
  const db = () =>
    new FakeDb({
      documents: [
        { id: "1", d: { attempt: "03" }, v: null, u: "ABCDEF00-0000-4000-8000-000000000000" },
        { id: "2", d: { attempt: 3 }, v: "x" },
        { id: "3", d: { attempt: true, nested: { a: 1 } } },
        { id: "4", d: ["a"] },
        { id: "5", d: null },
        { id: "6" },
      ],
    });
  const ids = async (f: (q: ReturnType<FakeDb["from"]>) => unknown) => {
    const r = (await f(db().from("documents").select("id"))) as { data: { id: string }[] };
    return r.data.map((x) => x.id);
  };
  it("`col->>key` reads jsonb text as Postgres does: text kept, numbers and booleans printed, missing and non-object parents are NULL", async () => {
    expect(await ids((q) => q.eq("d->>attempt", "03"))).toEqual(["1"]);
    expect(await ids((q) => q.eq("d->>attempt", "3"))).toEqual(["2"]);
    expect(await ids((q) => q.eq("d->>attempt", "true"))).toEqual(["3"]);
    expect(await ids((q) => q.is("d->>attempt", null))).toEqual(["4", "5", "6"]);
    expect(await ids((q) => q.eq("d->>attempt", 3))).toEqual([]); // typed: the real filter is text, a number never equals it
    expect(await ids((q) => q.eq("d->>__proto__", "x"))).toEqual([]);
    expect(await ids((q) => q.eq("d->>nested", '{"a":1}'))).toEqual([]); // Postgres prints {"a": 1}
  });
  // DIVERGENCE (low, test infrastructure): PostgREST `eq.null` compares with the TEXT "null" and never
  // matches a NULL column; FakeDb.eq(col, null) matches NULL rows. A service that wrote `.eq(col, null)`
  // would pass every FakeDb test and match nothing in production. (updateDocumentIf uses `.is`, so the
  // guard is safe; this is a trap for the next caller.)
  it("FakeDb.eq(col, null) must not match NULL rows, as PostgREST's eq.null does", async () => {
    expect(await ids((q) => q.eq("v", null))).toEqual([]);
  });
  // DIVERGENCE (low): Postgres compares uuid columns case-insensitively; FakeDb compares strings.
  // A guard on `current_version_id` written from an upper-case id passes in Postgres, fails here.
  it("FakeDb.eq on a uuid column ignores letter case, as Postgres does", async () => {
    expect(await ids((q) => q.eq("u", "abcdef00-0000-4000-8000-000000000000"))).toEqual(["1"]);
  });
  // DIVERGENCE (low): Postgres prints jsonb objects with a space after the colon ({"a": 1}); FakeDb
  // prints compact JSON. Nothing in phases 1-2 compares object text; it matters if a guard ever does.
  it('FakeDb `->>` of a nested object prints it as Postgres does ({"a": 1})', async () => {
    expect(await ids((q) => q.eq("d->>nested", '{"a": 1}'))).toEqual(["3"]);
  });
});
