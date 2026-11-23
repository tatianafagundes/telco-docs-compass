// Adding or restoring a version keeps every quarantine and never overwrites a change made meanwhile
// (file-hooks spec R4.8, D5, BR-155; security review H2, M3).
import { describe, expect, it } from "vitest";
import { addVersionStep } from "@/services/document-add-version";
import type { WriteEnv } from "@/services/seam-runtime";
import { FakeDb, type Row } from "@/test/fake-db";

const D = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const V3 = "33333333-3333-4333-8333-333333333333";
const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;

function world(doc: Partial<Row> = {}, versions: Row[] = []) {
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
    role: "contributor",
  } as WriteEnv;
  return { admin, env, doc: () => admin.rows("documents")[0]! };
}
const upload = { id: D, mimeType: "application/pdf", size: 10, contentHash: HASH };

describe("addVersionStep", () => {
  it("a new version starts from uploading and keeps the quarantine list and attempt", async () => {
    const w = world({ pipeline_detail: { attempt: 2, quarantinedVersions: [V1] } });
    const r = await addVersionStep(w.env, upload);
    expect(r.ok).toBe(true);
    expect(w.doc()).toMatchObject({
      pipeline_state: "uploading",
      pipeline_detail: { attempt: 2, quarantinedVersions: [V1] },
    });
  });
  it("a document quarantined before the list existed keeps its version blocked", async () => {
    const w = world({ pipeline_state: "quarantined", pipeline_detail: { reason: "threat" } });
    await addVersionStep(w.env, upload);
    expect(w.doc()["pipeline_detail"]).toMatchObject({ quarantinedVersions: [V2] });
  });
  it("never restores a quarantined version", async () => {
    const w = world({ pipeline_detail: { quarantinedVersions: [V1] } }, [
      {
        id: V1,
        content_hash: HASH,
        storage_path: "t1/v1",
        label: "1",
        mime_type: "application/pdf",
      },
    ]);
    const r = await addVersionStep(w.env, {
      id: D,
      mimeType: "application/pdf",
      restoreFromVersionId: V1,
    });
    expect(!r.ok && r.error.code).toBe("doc.version.quarantined");
    expect(w.admin.writesTo("document_versions")).toEqual([]);
  });
  it.each([
    ["the same stored file", { content_hash: OTHER, storage_path: "t1/v1" }],
    ["the same bytes", { content_hash: HASH.replace("sha256:", ""), storage_path: "t1/v3" }],
  ])("never restores a version with %s as a quarantined one", async (_n, copy) => {
    const w = world({ pipeline_detail: { quarantinedVersions: [V1] } }, [
      {
        id: V1,
        content_hash: HASH,
        storage_path: "t1/v1",
        label: "1",
        mime_type: "application/pdf",
      },
      { id: V3, label: "3", mime_type: "application/pdf", ...copy },
    ]);
    const r = await addVersionStep(w.env, {
      id: D,
      mimeType: "application/pdf",
      restoreFromVersionId: V3,
    });
    expect(!r.ok && r.error.code).toBe("doc.version.quarantined");
    expect(w.admin.writesTo("document_versions")).toEqual([]);
  });
  it("restores a clean version as a new one, to be checked again", async () => {
    const w = world({ pipeline_detail: { quarantinedVersions: [V1] } }, [
      {
        id: V1,
        content_hash: HASH,
        storage_path: "t1/v1",
        label: "1",
        mime_type: "application/pdf",
      },
      {
        id: V3,
        content_hash: OTHER,
        storage_path: "t1/v3",
        label: "3",
        mime_type: "application/pdf",
      },
    ]);
    const r = await addVersionStep(w.env, {
      id: D,
      mimeType: "application/pdf",
      restoreFromVersionId: V3,
    });
    expect(r.ok).toBe(true);
    expect(w.doc()).toMatchObject({
      pipeline_state: "uploading",
      pipeline_detail: { quarantinedVersions: [V1] },
    });
  });
  it("does not overwrite a quarantine that landed while the version was being added", async () => {
    const w = world({
      pipeline_state: "quarantined",
      pipeline_detail: { attempt: 1, reason: "threat", quarantinedVersions: [V2] },
    });
    // It read the document while it was still scanning; the scan quarantined V2 before the write.
    w.admin.stubNextSelect("documents", [
      { ...w.doc(), pipeline_state: "scanning", pipeline_detail: { attempt: 1 } },
    ]);
    const r = await addVersionStep(w.env, upload);
    expect(!r.ok && r.error.code).toBe("doc.changedMeanwhile");
    expect(w.doc()).toMatchObject({
      pipeline_state: "quarantined",
      current_version_id: V2,
      pipeline_detail: { quarantinedVersions: [V2] },
    });
  });
  it("the group administrator cannot add versions", async () => {
    const w = world();
    const r = await addVersionStep({ ...w.env, role: "master_admin" }, upload);
    expect(r.ok).toBe(false);
    expect(w.admin.writesTo("document_versions")).toEqual([]);
  });
  it("two versions with no recorded hash are not the same file", async () => {
    const w = world({ pipeline_detail: { quarantinedVersions: [V1] } }, [
      { id: V1, content_hash: "", storage_path: "t1/v1", label: "1", mime_type: "application/pdf" },
      { id: V3, content_hash: "", storage_path: "t1/v3", label: "3", mime_type: "application/pdf" },
    ]);
    const r = await addVersionStep(w.env, {
      id: D,
      mimeType: "application/pdf",
      restoreFromVersionId: V3,
    });
    expect(r.ok).toBe(true);
  });
});
