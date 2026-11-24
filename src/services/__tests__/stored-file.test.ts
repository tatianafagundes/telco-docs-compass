// A stored file is read for processing only when the bucket says it is within the limit
// (file-hooks final seg H2): a file uploaded larger than declared is never fetched into memory.
import { afterEach, describe, expect, it, vi } from "vitest";
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
  describe("when the listing carries no size", () => {
    afterEach(() => vi.unstubAllGlobals());
    const noSize = (db: FakeDb) => {
      // `storage` is a getter that builds the stub each time: wrap the getter itself.
      const getter = Object.getOwnPropertyDescriptor(FakeDb.prototype, "storage")!.get!;
      Object.defineProperty(db, "storage", {
        get() {
          const store = getter.call(db) as { from: (b: string) => object };
          return {
            from: (b: string) => ({
              ...store.from(b),
              list: async () => ({ data: [{ name: "v1", metadata: null }], error: null }),
            }),
          };
        },
      });
    };
    /** A body of `n` bytes in 1 KB chunks, counting how many were read. */
    const body = (n: number) => {
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (sent >= n) return c.close();
          const k = Math.min(1024, n - sent);
          sent += k;
          c.enqueue(new Uint8Array(k));
        },
      });
      return { res: new Response(stream), read: () => sent };
    };
    it("reads through a short-lived address and stops at the limit, never the whole file", async () => {
      const db = world(5);
      noSize(db);
      const b = body(10 * 1024 * 1024);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => b.res),
      );
      expect(await read(db, 64 * 1024)).toBe("tooLarge");
      expect(b.read()).toBeLessThan(200 * 1024);
      // Never the buffered download.
      expect(db.storageCalls.map((c) => c.op)).toEqual(["createSignedUrl"]);
    });
    it("a file within the limit is read whole", async () => {
      const db = world(5);
      noSize(db);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => body(3000).res),
      );
      const r = await read(db, 64 * 1024);
      expect(r instanceof Uint8Array && r.byteLength).toBe(3000);
    });
  });
});
