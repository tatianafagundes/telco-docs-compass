// Checking a detail read from the file (file-hooks final review M1): only a detail of the current
// version becomes a document detail, and two decisions at once cannot both apply.
import { describe, expect, it } from "vitest";
import { reviewExtractionStep } from "@/services/document-review-step";
import type { WriteEnv } from "@/services/seam-runtime";
import { FakeDb, type Row } from "@/test/fake-db";

const D = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";
const F = "44444444-4444-4444-8444-444444444444";
function world(field: Row = {}, doc: Row = {}) {
  const db = new FakeDb({
    documents: [
      {
        id: D,
        tenant_id: "t1",
        name: "Contract.pdf",
        status: "draft",
        characteristic: [],
        current_version_id: V1,
        ...doc,
      },
    ],
    extraction_fields: [
      {
        id: F,
        document_id: D,
        version_id: V1,
        tenant_id: "t1",
        name: "amount",
        value: "48000",
        original_value: null,
        status: "pending",
        ...field,
      },
    ],
    document_events: [],
  });
  const env = {
    admin: db.asDb(),
    caller: db.asDb(),
    userId: "u1",
    tenantId: "t1",
    role: "reviewer",
  } as WriteEnv;
  return { db, env };
}
const accept = { id: D, idempotencyKey: "k-12345678", fieldId: F, decision: "accept" as const };

describe("reviewExtractionStep", () => {
  it("accepts a detail of the current version into the document's details", async () => {
    const { db, env } = world();
    const r = await reviewExtractionStep(env, accept);
    expect(r.ok).toBe(true);
    expect(db.rows("extraction_fields")[0]).toMatchObject({ status: "accepted" });
    expect(db.rows("documents")[0]!["characteristic"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "amount", value: "48000" })]),
    );
  });
  it("refuses a detail read from an earlier version, and writes nothing", async () => {
    const { db, env } = world({}, { current_version_id: V2 });
    const r = await reviewExtractionStep(env, accept);
    expect(!r.ok && r.error.code).toBe("extraction.field.notCurrent");
    expect(db.writes).toEqual([]);
  });
  it("a decision made meanwhile wins; the second one changes nothing", async () => {
    const { db, env } = world();
    db.stubNextSelect("extraction_fields", [{ ...db.rows("extraction_fields")[0]! }]);
    db.rows("extraction_fields")[0]!["status"] = "rejected";
    const r = await reviewExtractionStep(env, accept);
    expect(!r.ok && r.error.code).toBe("doc.changedMeanwhile");
    expect(db.rows("extraction_fields")[0]!["status"]).toBe("rejected");
    expect(db.writesTo("documents")).toEqual([]);
  });
  it("a detail of another organisation is not found", async () => {
    const { env } = world({ tenant_id: "t2" });
    const r = await reviewExtractionStep(env, accept);
    expect(!r.ok && r.error.code).toBe("extraction.field.notFound");
  });
  it("a checked detail can still be changed by a person (Change)", async () => {
    const { db, env } = world({ status: "accepted" });
    const r = await reviewExtractionStep(env, { ...accept, decision: "edit", value: "50000" });
    expect(r.ok).toBe(true);
    expect(db.rows("extraction_fields")[0]).toMatchObject({ status: "edited", value: "50000" });
  });
});
