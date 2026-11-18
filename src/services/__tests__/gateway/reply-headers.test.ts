import { describe, expect, it, vi } from "vitest";
import { buildWorld, call, DOC_ID } from "@/test/gateway-world";
import { getDocument } from "@/test/gateway-api";
import { reply } from "@/services/gateway-reply";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

describe("headers that follow from the status", () => {
  it.each([
    ["no key", null],
    ["a wrong key", "erad_" + "z".repeat(24)],
  ])("a 401 for %s says how to authenticate", async (_label, key) => {
    await buildWorld();
    const res = await getDocument(call("GET", `/document/${DOC_ID}`, { key }), DOC_ID);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer realm="document-api"');
  });
  it("other answers do not carry it", async () => {
    await buildWorld();
    const res = await getDocument(call("GET", `/document/${DOC_ID}`), DOC_ID);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
    expect(res.headers.get("Location")).toBeNull();
  });
  it("a 201 without an href has no Location, and a 200 with one does not either", () => {
    expect(reply(201, {}, "r").headers.get("Location")).toBeNull();
    expect(reply(200, { href: "https://x" }, "r").headers.get("Location")).toBeNull();
    expect(reply(201, { href: "https://x/1" }, "r").headers.get("Location")).toBe("https://x/1");
  });
});
