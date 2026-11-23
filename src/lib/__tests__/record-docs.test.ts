import { describe, expect, it } from "vitest";
import { DEFAULT_RECORD_SORT, nextRecordSort, sortRecordDocs } from "@/lib/record-docs";
const docs = [
  { name: "b quote", document_type: "quote", updated_at: "2026-11-01T00:00:00Z" },
  { name: "a contract", document_type: "contract", updated_at: "2026-11-03T00:00:00Z" },
  { name: "c quote", document_type: "quote", updated_at: "2026-11-01T00:00:00Z" },
];
const label = (c: string) => ({ quote: "Quote", contract: "Contract" })[c] ?? c;
describe("record documents table", () => {
  it("should list the most recently changed first by default, ties by name", () => {
    expect(sortRecordDocs(docs, DEFAULT_RECORD_SORT, label).map((d) => d.name)).toEqual([
      "a contract",
      "b quote",
      "c quote",
    ]);
  });
  it("should sort by the type people read and by name", () => {
    expect(sortRecordDocs(docs, { key: "type", dir: "desc" }, label).map((d) => d.name)).toEqual([
      "b quote",
      "c quote",
      "a contract",
    ]);
    expect(sortRecordDocs(docs, { key: "name", dir: "asc" }, label)[0]?.name).toBe("a contract");
  });
  it("should flip the same column and start a new one in its natural order", () => {
    expect(nextRecordSort(DEFAULT_RECORD_SORT, "changed")).toEqual({ key: "changed", dir: "asc" });
    expect(nextRecordSort(DEFAULT_RECORD_SORT, "name")).toEqual({ key: "name", dir: "asc" });
  });
});
