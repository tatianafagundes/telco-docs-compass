// A stored file is read for processing only when the bucket says it is within the limit
// (file-hooks final seg H2): a file uploaded larger than declared is never fetched into memory.
import { describe, expect, it } from "vitest";
import { downloadWithin } from "@/services/stored-file";
import { FakeDb } from "@/test/fake-db";

const world = (bytes: number) => {
  const db = new FakeDb();
  db.objects.set("documents/t1/v1", new Uint8Array(bytes));
  db.objects.set("documents/t1/v10", new Uint8Array(1));
  return db;
};
const read = (db: FakeDb, max: number, path = "t1/v1") =>
  downloadWithin(db.asDb(), "documents", path, max);

describe("downloadWithin", () => {
  it("reads a file within the limit", async () => {
    const r = await read(world(10), 10);
    expect(r instanceof Uint8Array && r.byteLength).toBe(10);
  });
  it("refuses a larger file from its listed size, without downloading it", async () => {
    const db = world(11);
    expect(await read(db, 10)).toBe("tooLarge");
    expect(db.storageCalls.map((c) => c.op)).toEqual(["list"]);
  });
  it("matches the file's own name, never a longer one that contains it", async () => {
    const db = world(5);
    db.objects.delete("documents/t1/v1");
    expect(await read(db, 10)).toBeNull();
    expect(db.storageCalls.map((c) => c.op)).toEqual(["list"]);
  });
  it("a failed listing reads as no file", async () => {
    const db = world(5).failStorage("list");
    expect(await read(db, 10)).toBeNull();
  });
});
