// The first version of a new document, as the screens register it: the person is recorded and the
// upload address (with its token) is handed back. The API-side cases are in gateway/create-document.
import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { storeFirstVersion } from "@/services/document-first-version";

const world = () =>
  new FakeDb({
    documents: [{ id: "d1", tenant_id: "t1" }],
    document_versions: [],
    document_relations: [],
  });
const input = {
  documentId: "d1",
  tenantId: "t1",
  mimeType: "application/pdf",
  sizeBytes: 5,
  contentHash: "h",
  bytes: null,
  related: [{ id: "e1", role: "contract" }],
};

describe("storeFirstVersion for a screen", () => {
  it("records who registered it and returns the upload address and token", async () => {
    const db = world();
    const res = await storeFirstVersion(db.asDb(), { ...input, createdBy: "user-1" });
    expect(res).toMatchObject({ ok: true, uploadToken: "t" });
    expect(res.ok && res.uploadUrl).toContain("https://storage.example/documents/t1/");
    expect(db.rows("document_versions")[0]).toMatchObject({ created_by: "user-1", label: "1" });
  });
  it("leaves created_by out when no person did it", async () => {
    const db = world();
    await storeFirstVersion(db.asDb(), input);
    expect(db.rows("document_versions")[0]).not.toHaveProperty("created_by");
  });
  it("hides the document and reports the step when a write fails", async () => {
    const db = world().fail("document_relations", "insert");
    const res = await storeFirstVersion(db.asDb(), { ...input, createdBy: "user-1" });
    expect(res).toEqual({
      ok: false,
      step: "database error while linking a new document to its records",
    });
    expect(db.rows("documents")[0]?.["deleted_at"]).toBeTruthy();
  });
});
