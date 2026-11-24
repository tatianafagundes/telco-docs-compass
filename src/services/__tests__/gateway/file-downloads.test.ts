// Downloads for the organisation's own antivirus and reader, and quarantined versions (file-hooks
// spec R2.1, R3.1, D5; task 5.5).
import { describe, expect, it, vi } from "vitest";
import { getAttachmentContent } from "@/test/gateway-api";
import { buildWorld, call, DOC_ID, docRow, json, OTHER_TENANT, TENANT } from "@/test/gateway-world";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);
const V = "33333333-3333-4333-8333-333333333333";
const OLD = "44444444-4444-4444-8444-444444444444";
const link = (att = V) =>
  getAttachmentContent(call("GET", `/document/${DOC_ID}/attachment/${att}/content`), DOC_ID, att);
async function world(scopes: string[], doc: Record<string, unknown>) {
  const db = await buildWorld({
    scopes,
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
const scanning = {
  pipeline_state: "scanning",
  pipeline_detail: { mode: "external", byClient: "client-1", step: "scan", attempt: 3 },
};

describe("the organisation's antivirus downloads the file it checks", () => {
  it("gets the current version during its own step, and the download is recorded with the attempt", async () => {
    const db = await world(["scan"], scanning);
    const res = await link();
    expect(res.status).toBe(200);
    expect(db.rows("document_events")).toMatchObject([
      {
        action: "scanDownload",
        document_id: DOC_ID,
        version_id: V,
        detail: "attempt 3 · via Order care",
      },
    ]);
  });
  it.each([
    ["an older version", OLD, scanning],
    [
      "a simulated step",
      V,
      { ...scanning, pipeline_detail: { mode: "simulated", byClient: "client-1" } },
    ],
    [
      "another system's step",
      V,
      { ...scanning, pipeline_detail: { ...scanning.pipeline_detail, byClient: "client-9" } },
    ],
    [
      "a document being read",
      V,
      { pipeline_state: "reading", pipeline_detail: { mode: "external", byClient: "client-1" } },
    ],
    ["a ready document", V, { pipeline_state: "ready" }],
  ])("is refused for %s", async (_n, att, doc) => {
    const db = await world(["scan"], doc);
    const res = await link(att);
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("notYourStep");
    expect(db.storageCalls).toEqual([]);
  });
});

describe("the organisation's reader", () => {
  it("gets the current version during its own reading step, without a scan record", async () => {
    const db = await world(["extract"], {
      pipeline_state: "reading",
      pipeline_detail: { mode: "external", byClient: "client-1", step: "read" },
    });
    expect((await link()).status).toBe(200);
    expect(db.rows("document_events")).toMatchObject([{ action: "download" }]);
  });
});

describe("quarantined versions", () => {
  it("are never downloaded, also an older one of a document that is ready again", async () => {
    const db = await world(["read"], {
      pipeline_state: "ready",
      pipeline_detail: { quarantinedVersions: [OLD] },
    });
    const res = await link(OLD);
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("quarantined");
    expect(db.storageCalls).toEqual([]);
    expect((await link(V)).status).toBe(200);
  });
  it("a quarantined version is refused to its own scanner too", async () => {
    await world(["scan"], {
      ...scanning,
      pipeline_detail: { ...scanning.pipeline_detail, quarantinedVersions: [V] },
    });
    expect((await json(await link()))["code"]).toBe("quarantined");
  });
});

describe("versions are pinned to the key's organisation", () => {
  it("a version row of another organisation is not found, even under this document id", async () => {
    const db = await world(["read"], {});
    db.rows("document_versions")[0]!["tenant_id"] = OTHER_TENANT;
    expect((await link()).status).toBe(404);
  });
  it("a version id that is not a uuid is not found, without a query", async () => {
    await world(["read"], {});
    expect((await link("../x")).status).toBe(404);
  });
  it("a key with none of read, scan or extract is refused", async () => {
    await world(["register"], {});
    const res = await link();
    expect(res.status).toBe(403);
    expect((await json(res))["code"]).toBe("scopeMissing");
  });
});
