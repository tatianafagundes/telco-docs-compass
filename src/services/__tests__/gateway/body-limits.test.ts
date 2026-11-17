// A connected system cannot make the gateway load a huge body, with or without a valid key.
import { describe, expect, it, vi } from "vitest";
import { buildWorld, call, DOC_ID, json } from "@/test/gateway-world";
import { createDocument, issueToken, patchDocument, transitionDocument } from "@/test/gateway-api";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

/** A request whose body is a stream of 1 KB chunks; `pulled()` says how many were read. */
function streamed(path: string, method: string, key: string | null, chunks = 100_000) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled >= chunks) return c.close();
      pulled++;
      c.enqueue(new Uint8Array(1024).fill(32));
    },
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": "idem-key-0001",
  };
  if (key) headers["authorization"] = `Bearer ${key}`;
  const request = new Request(`https://app.example/api/public/tmf-api/document/v4${path}`, {
    method,
    headers,
    body,
    duplex: "half",
  } as RequestInit);
  return { request, pulled: () => pulled };
}
import { KEY } from "@/test/gateway-world";

describe("a body with no declared length is cut off at the limit", () => {
  it.each([
    ["a valid key on PATCH", "PATCH", `/document/${DOC_ID}`, KEY, patchDocument, 413],
    ["no key on PATCH", "PATCH", `/document/${DOC_ID}`, null, patchDocument, 401],
    [
      "a wrong key on PATCH",
      "PATCH",
      `/document/${DOC_ID}`,
      "erad_" + "z".repeat(24),
      patchDocument,
      401,
    ],
    [
      "a valid key on a status task",
      "POST",
      `/document/${DOC_ID}/transition`,
      KEY,
      transitionDocument,
      413,
    ],
    [
      "no key on a status task",
      "POST",
      `/document/${DOC_ID}/transition`,
      null,
      transitionDocument,
      401,
    ],
  ] as const)("%s", async (_label, method, path, key, handler, status) => {
    await buildWorld();
    const { request, pulled } = streamed(path, method, key);
    const res = await (handler as (r: Request, id: string) => Promise<Response>)(request, DOC_ID);
    expect(res.status).toBe(status);
    // Far less than the 100 MB on offer was read, whatever the answer.
    expect(pulled()).toBeLessThan(200);
  });
  it("refuses a registration over the inline limit with 413", async () => {
    await buildWorld();
    const { request, pulled } = streamed("", "POST", KEY, 8_000); // 8 MB > the 6.7 MB inline limit
    const res = await createDocument(request);
    expect(res.status).toBe(413);
    expect((await json(res))["code"]).toBe("bodyTooLarge");
    expect(pulled()).toBeLessThan(7_000);
  });
  it("refuses a token request over 4 KB before reading more", async () => {
    await buildWorld();
    const { request, pulled } = streamed("/oauth/token", "POST", null);
    const res = await issueToken(request);
    expect(res.status).toBe(400);
    expect(pulled()).toBeLessThan(20);
  });
});

describe("a declared length over the limit is refused unread", () => {
  it("on a registration", async () => {
    await buildWorld();
    const req = call("POST", "/document", { body: {}, headers: { "content-length": "99999999" } });
    expect((await createDocument(req)).status).toBe(413);
  });
});
