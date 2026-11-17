import { describe, expect, it } from "vitest";
import { readRequestText, readResponseBytes } from "@/services/gateway-body";

/** A body that hands out `chunks` of `size` bytes, counting how many were asked for. */
function endless(size: number, chunks: number) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(97));
    },
  });
  return { stream, pulled: () => pulled };
}
const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("https://x.example/", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);

describe("readRequestText", () => {
  it("returns the text of a body within the limit", async () => {
    expect(await readRequestText(post('{"a":1}'), 100)).toEqual({
      value: '{"a":1}',
      tooLarge: false,
    });
  });
  it("accepts a body of exactly the limit and refuses one byte more", async () => {
    expect((await readRequestText(post("a".repeat(10)), 10)).tooLarge).toBe(false);
    expect((await readRequestText(post("a".repeat(11)), 10)).tooLarge).toBe(true);
  });
  it("reads an empty or missing body as empty text", async () => {
    expect(await readRequestText(post(null), 10)).toEqual({ value: "", tooLarge: false });
  });
  it("keeps multi-byte characters whole", async () => {
    expect((await readRequestText(post("åäö"), 100)).value).toBe("åäö");
  });
  it("refuses on the declared length without reading the body", async () => {
    const { stream, pulled } = endless(1000, 5);
    const res = await readRequestText(post(stream, { "content-length": "5000000" }), 100);
    expect(res.tooLarge).toBe(true);
    expect(pulled()).toBeLessThanOrEqual(1); // the runtime prefetches one chunk by itself
  });
  it("stops reading a long body that declares no length, soon after the limit", async () => {
    const { stream, pulled } = endless(1000, 100_000);
    const res = await readRequestText(post(stream), 10_000);
    expect(res.tooLarge).toBe(true);
    expect(pulled()).toBeLessThan(20);
  });
  it("stops when the declared length is false", async () => {
    const { stream, pulled } = endless(1000, 100_000);
    const res = await readRequestText(post(stream, { "content-length": "5" }), 10_000);
    expect(res.tooLarge).toBe(true);
    expect(pulled()).toBeLessThan(20);
  });
});

describe("readResponseBytes", () => {
  it("returns a file within the limit", async () => {
    const res = await readResponseBytes(new Response("hello"), 10);
    expect(new TextDecoder().decode(res.value)).toBe("hello");
  });
  it("refuses on the declared length", async () => {
    const r = new Response("x", { headers: { "content-length": "99999999" } });
    expect((await readResponseBytes(r, 10)).tooLarge).toBe(true);
  });
  it("stops a stream that goes past the limit without a declared length", async () => {
    const { stream, pulled } = endless(1000, 100_000);
    const res = await readResponseBytes(new Response(stream), 10_000);
    expect(res.tooLarge).toBe(true);
    expect(pulled()).toBeLessThan(20);
  });
});
