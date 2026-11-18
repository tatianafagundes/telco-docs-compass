import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { approvalRefusal } from "@/services/document-approval";
import { DatabaseError } from "@/services/shared/must";

const SPEC = [{ name: "counterparty", required: true, extractable: true }] as never;
const doc = { id: "d1", current_version_id: "v1" };
const field = (status: string, version = "v1") => ({
  document_id: "d1",
  version_id: version,
  name: "counterparty",
  status,
});
const db = (rows: Record<string, unknown>[] = []) => new FakeDb({ extraction_fields: rows });

describe("approvalRefusal", () => {
  it("refuses own work first, without reading anything", async () => {
    const d = db().fail("extraction_fields", "select");
    expect(await approvalRefusal(d.asDb(), doc, SPEC, true)).toEqual({ kind: "ownWork" });
  });
  it("waits for a required detail that is pending, rejected or missing", async () => {
    for (const rows of [[field("pending")], [field("rejected")], []])
      expect(await approvalRefusal(db(rows).asDb(), doc, SPEC, false)).toEqual({
        kind: "detailsPending",
        count: 1,
      });
  });
  it("lets it go ahead once the detail is accepted or edited", async () => {
    for (const s of ["accepted", "edited"])
      expect(await approvalRefusal(db([field(s)]).asDb(), doc, SPEC, false)).toBeNull();
  });
  it("ignores a detail confirmed on an older version", async () => {
    expect(await approvalRefusal(db([field("accepted", "v0")]).asDb(), doc, SPEC, false)).toEqual({
      kind: "detailsPending",
      count: 1,
    });
  });
  it("lets a document with no required details go ahead", async () => {
    expect(await approvalRefusal(db().asDb(), doc, [], false)).toBeNull();
  });
  it("throws instead of reading a failed query as nothing pending", async () => {
    await expect(
      approvalRefusal(db().fail("extraction_fields", "select").asDb(), doc, SPEC, false),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});
