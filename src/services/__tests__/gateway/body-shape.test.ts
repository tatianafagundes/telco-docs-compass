// A body's lists and nesting are bounded before any schema runs (file-hooks final seg H1): a schema
// checks every element of a list before its length rule, so many empty objects would cost far more
// than their bytes.
import { describe, expect, it, vi } from "vitest";
import { jsonShapeRefusal, MAX_JSON_ARRAY, MAX_JSON_DEPTH } from "@/services/gateway-body";
import { createDocument, postExtractionResult } from "@/test/gateway-api";
import { buildWorld, call, DOC_ID } from "@/test/gateway-world";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const V = "33333333-3333-4333-8333-333333333333";
describe("jsonShapeRefusal", () => {
  it("accepts lists of the limit and nesting just under it", () => {
    expect(jsonShapeRefusal({ a: Array(MAX_JSON_ARRAY).fill({}) })).toBeNull();
    let deep: unknown = 1;
    for (let i = 0; i < MAX_JSON_DEPTH; i++) deep = [deep];
    expect(jsonShapeRefusal(deep)).toBeNull();
  });
  it("refuses a longer list anywhere, and deeper nesting", () => {
    expect(jsonShapeRefusal({ a: { b: Array(MAX_JSON_ARRAY + 1).fill(0) } })).toBe("list");
    let deep: unknown = {};
    for (let i = 0; i < MAX_JSON_DEPTH + 1; i++) deep = [deep];
    expect(jsonShapeRefusal(deep)).toBe("depth");
  });
});
describe("the API refuses them before the schema", () => {
  it("a reader's answer with 50 000 empty fields is a quick 400 that writes nothing", async () => {
    const db = await buildWorld({ scopes: ["extract"] });
    const started = performance.now();
    const res = await postExtractionResult(
      call("POST", `/document/${DOC_ID}/attachment/${V}/extractionResult`, {
        body: { result: "read", attempt: 1, fields: Array(50_000).fill({}) },
        idempotencyKey: "shape-key-0001",
      }),
      DOC_ID,
      V,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalidBody");
    expect(performance.now() - started).toBeLessThan(500);
    expect(db.writesTo("documents")).toEqual([]);
    expect(db.writesTo("idempotency_keys")).toEqual([]);
  });
  it("a registration with too many links is refused the same way", async () => {
    await buildWorld({ scopes: ["register"] });
    const res = await createDocument(
      call("POST", "/document", {
        body: { name: "x", relatedEntity: Array(5_000).fill({}) },
        idempotencyKey: "shape-key-0002",
      }),
    );
    expect(res.status).toBe(400);
  });
});
