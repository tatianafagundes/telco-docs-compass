// QA, adversarial: the download rule for every state and key kind (R2.1, R3.1, D5, BR-159), through
// the HTTP handler only. The expectations come from the spec, not from the code: a checked file for
// `read` keys, the current version in its own external step for the scanner and the reader, and a
// quarantined version for nobody.
// Tests that expose a real defect are `it.fails` with the defect named above them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAttachmentContent } from "@/test/gateway-api";
import {
  buildWorld,
  call,
  CLIENT_ID,
  DOC_ID,
  docRow,
  json,
  KEY,
  OTHER_TENANT,
  TENANT,
} from "@/test/gateway-world";
import type { FakeDb } from "@/test/fake-db";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);
const V = "33333333-3333-4333-8333-333333333333";
const OLD = "44444444-4444-4444-8444-444444444444";
let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const k of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, k).mockImplementation(
      (...a: unknown[]) => void logs.push(a.map(String).join(" ")),
    );
});
afterEach(() => {
  vi.restoreAllMocks();
});
const d = (over: Record<string, unknown> = {}) => ({
  mode: "external",
  by: "Order care",
  byClient: CLIENT_ID,
  attempt: 3,
  quarantinedVersions: [],
  ...over,
});
async function world(scope: string, doc: Record<string, unknown>) {
  const db = await buildWorld({
    scopes: [scope],
    documents: [docRow({ current_version_id: V, ...doc })],
  });
  db.tables["document_versions"] = [V, OLD].map((id) => ({
    id,
    document_id: DOC_ID,
    tenant_id: TENANT,
    storage_path: `${TENANT}/${id}`,
  }));
  return db;
}
const link = (att = V, id = DOC_ID) =>
  getAttachmentContent(call("GET", `/document/${id}/attachment/${att}/content`), id, att);
const codeOf = async (res: Response) => (await json(res))["code"];
const signed = (db: FakeDb) => db.storageCalls.filter((c) => c.op === "createSignedUrl").length;

type Row = [
  label: string,
  doc: Record<string, unknown>,
  read: string,
  scan: string,
  extract: string,
];
const OK = "ok";
const LOCK = "contentLocked";
const MINE = "notYourStep";
const Q = "quarantined";
// Rows: the document as stored; what a read key, the scanner and the reader get for the current version.
const MATRIX: Row[] = [
  ["uploading", { pipeline_state: "uploading", pipeline_detail: null }, LOCK, MINE, MINE],
  [
    "scanning, own external step",
    { pipeline_state: "scanning", pipeline_detail: d({ step: "scan" }) },
    LOCK,
    OK,
    MINE,
  ],
  [
    "scanning, another system's step",
    { pipeline_state: "scanning", pipeline_detail: d({ step: "scan", byClient: "client-9" }) },
    LOCK,
    MINE,
    MINE,
  ],
  [
    "scanning, no system connected",
    {
      pipeline_state: "scanning",
      pipeline_detail: d({ step: "scan", by: undefined, byClient: undefined }),
    },
    LOCK,
    MINE,
    MINE,
  ],
  [
    "scanning, built-in",
    { pipeline_state: "scanning", pipeline_detail: d({ mode: "simulated", step: "scan" }) },
    LOCK,
    MINE,
    MINE,
  ],
  [
    "scanning, no detail at all",
    { pipeline_state: "scanning", pipeline_detail: null },
    LOCK,
    MINE,
    MINE,
  ],
  [
    "reading, own external step",
    { pipeline_state: "reading", pipeline_detail: d({ step: "read" }) },
    OK,
    MINE,
    OK,
  ],
  [
    "reading, another system's step",
    { pipeline_state: "reading", pipeline_detail: d({ step: "read", byClient: "client-9" }) },
    OK,
    MINE,
    MINE,
  ],
  [
    "reading, built-in",
    { pipeline_state: "reading", pipeline_detail: d({ mode: "simulated", step: "read" }) },
    OK,
    MINE,
    MINE,
  ],
  ["ready", { pipeline_state: "ready", pipeline_detail: null }, OK, MINE, MINE],
  [
    "ready, with a detail of its own",
    { pipeline_state: "ready", pipeline_detail: d({ step: "read" }) },
    OK,
    MINE,
    MINE,
  ],
  [
    "failed: unreadable",
    { pipeline_state: "failed", pipeline_detail: d({ step: "read", reason: "unreadable" }) },
    OK,
    MINE,
    MINE,
  ],
  [
    "failed: reader gave no answer",
    { pipeline_state: "failed", pipeline_detail: d({ step: "read", reason: "noResult" }) },
    OK,
    MINE,
    MINE,
  ],
  [
    "failed: scan error",
    { pipeline_state: "failed", pipeline_detail: d({ step: "scan", reason: "scanError" }) },
    LOCK,
    MINE,
    MINE,
  ],
  [
    "failed: antivirus gave no answer",
    { pipeline_state: "failed", pipeline_detail: d({ step: "scan", reason: "noResult" }) },
    LOCK,
    MINE,
    MINE,
  ],
  [
    "failed: file never arrived",
    { pipeline_state: "failed", pipeline_detail: d({ reason: "noFile" }) },
    LOCK,
    MINE,
    MINE,
  ],
  [
    "failed: scan error recorded by reason only",
    { pipeline_state: "failed", pipeline_detail: { attempt: 2, reason: "scanError" } },
    LOCK,
    MINE,
    MINE,
  ],
  [
    "failed: file never arrived, with a read step left in it",
    { pipeline_state: "failed", pipeline_detail: d({ step: "read", reason: "noFile" }) },
    LOCK,
    MINE,
    MINE,
  ],
  [
    "failed: older detail without step or reason (a reading failure)",
    { pipeline_state: "failed", pipeline_detail: null },
    OK,
    MINE,
    MINE,
  ],
  [
    "quarantined",
    {
      pipeline_state: "quarantined",
      pipeline_detail: d({ step: "scan", reason: "threat", quarantinedVersions: [V] }),
    },
    Q,
    Q,
    Q,
  ],
  [
    "quarantined, before the list existed",
    { pipeline_state: "quarantined", pipeline_detail: null },
    Q,
    Q,
    Q,
  ],
  [
    "ready but the version is on the list",
    { pipeline_state: "ready", pipeline_detail: d({ quarantinedVersions: [V] }) },
    Q,
    Q,
    Q,
  ],
  [
    "scanning again but the version is on the list",
    { pipeline_state: "scanning", pipeline_detail: d({ step: "scan", quarantinedVersions: [V] }) },
    Q,
    Q,
    Q,
  ],
  [
    "the list stored in upper case",
    { pipeline_state: "ready", pipeline_detail: d({ quarantinedVersions: [V.toUpperCase()] }) },
    Q,
    Q,
    Q,
  ],
];

describe("the current version, for every state and key kind", () => {
  for (const [label, doc, read, scan, extract] of MATRIX)
    for (const [scope, want] of [
      ["read", read],
      ["scan", scan],
      ["extract", extract],
    ] as const)
      it(`${label} → ${scope} key: ${want}`, async () => {
        const db = await world(scope, doc);
        const res = await link();
        if (want === OK) {
          expect(res.status).toBe(200);
          expect(signed(db)).toBe(1);
        } else {
          expect(res.status).toBe(409);
          expect(await codeOf(res)).toBe(want);
          expect(signed(db)).toBe(0);
          expect(db.rows("document_events")).toEqual([]);
        }
        // The scanner's download is the only one that writes a receipt.
        const receipts = db.rows("document_events").filter((e) => e["action"] === "scanDownload");
        expect(receipts).toHaveLength(scope === "scan" && want === OK ? 1 : 0);
      });
});

describe("an older version", () => {
  it("a read key never gets an older version, even one never quarantined (seg H1)", async () => {
    const db = await world("read", {
      pipeline_state: "ready",
      pipeline_detail: d({ quarantinedVersions: [] }),
    });
    expect(await codeOf(await link(OLD))).toBe("notCurrent");
    expect(signed(db)).toBe(0);
  });
  it.each(["read", "scan", "extract"])(
    "a quarantined older version is refused to a %s key, the current one is not",
    async (scope) => {
      const db = await world(scope, {
        pipeline_state: scope === "scan" ? "scanning" : scope === "extract" ? "reading" : "ready",
        pipeline_detail: d({
          step: scope === "scan" ? "scan" : "read",
          quarantinedVersions: [OLD],
        }),
      });
      expect(await codeOf(await link(OLD))).toBe("quarantined");
      expect(signed(db)).toBe(0);
      expect((await link(V)).status).toBe(200);
    },
  );
  it.each([
    ["scan", "scanning", "scan"],
    ["extract", "reading", "read"],
  ])(
    "a %s key is refused a version that is not current, even in its own step",
    async (scope, state, step) => {
      const db = await world(scope, { pipeline_state: state, pipeline_detail: d({ step }) });
      expect(await codeOf(await link(OLD))).toBe("notYourStep");
      expect(signed(db)).toBe(0);
    },
  );
  it("a document with no current version gives a scanner nothing", async () => {
    await world("scan", {
      pipeline_state: "scanning",
      pipeline_detail: d({ step: "scan" }),
      current_version_id: null,
    });
    expect(await codeOf(await link())).toBe("notYourStep");
  });
});

describe("what is looked up, and in whose organisation", () => {
  it("a document of another organisation, an unknown one and a bad id are 404, never a link", async () => {
    const db = await world("scan", {
      tenant_id: OTHER_TENANT,
      pipeline_state: "scanning",
      pipeline_detail: d({ step: "scan" }),
    });
    expect((await link()).status).toBe(404);
    expect((await link(V, "55555555-5555-4555-8555-555555555555")).status).toBe(404);
    expect((await link("not-a-uuid")).status).toBe(404);
    expect(signed(db)).toBe(0);
  });
  it("a version row of another organisation is not found", async () => {
    const db = await world("scan", {
      pipeline_state: "scanning",
      pipeline_detail: d({ step: "scan" }),
    });
    db.rows("document_versions")[0]!["tenant_id"] = OTHER_TENANT;
    expect((await link()).status).toBe(404);
    expect(db.rows("document_events")).toEqual([]);
  });
  it("a version with no stored file is 404 before any rule is told", async () => {
    const db = await world("scan", {
      pipeline_state: "scanning",
      pipeline_detail: d({ step: "scan" }),
    });
    db.rows("document_versions")[0]!["storage_path"] = null;
    expect((await link()).status).toBe(404);
    expect(db.rows("document_events")).toEqual([]);
  });
  it("a deleted document is not found", async () => {
    await world("read", { pipeline_state: "ready", deleted_at: "2026-11-01T00:00:00Z" });
    expect((await link()).status).toBe(404);
  });
});

describe("failures", () => {
  it("the storage refusing to sign is a 503 and writes no receipt", async () => {
    const db = await world("scan", {
      pipeline_state: "scanning",
      pipeline_detail: d({ step: "scan" }),
    });
    db.failStorage("createSignedUrl");
    expect((await link()).status).toBe(503);
    expect(db.rows("document_events")).toEqual([]);
  });
  // A scanner is given the link and then the receipt is written. If the receipt cannot be written the
  // request must still answer with a TMF error body (a 503 the scanner can retry), never an unhandled
  // exception: this route has no write guard around it as the idempotent ones do.
  it.each(["scan", "read"])(
    "a %s key: the record failing to write answers 503 with a TMF body, never the link (QA D5)",
    async (scope) => {
      const db = await world(scope, {
        pipeline_state: scope === "scan" ? "scanning" : "ready",
        pipeline_detail: d({ step: scope === "scan" ? "scan" : "read" }),
      });
      db.fail("document_events", "insert");
      let res: Response | undefined;
      let thrown: unknown;
      try {
        res = await link();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeUndefined();
      expect(res!.status).toBe(503);
      const body = JSON.stringify(await json(res!));
      expect(body).toContain("unavailable");
      expect(body).not.toContain("token=");
    },
  );
  it("a download link never carries the signed address into the log", async () => {
    await world("scan", { pipeline_state: "scanning", pipeline_detail: d({ step: "scan" }) });
    await link();
    expect(logs.join("\n")).not.toContain("token=");
    expect(logs.join("\n")).not.toContain(KEY);
  });
});
