// The organisation's own antivirus and reader keys are checked again on every call (file-hooks spec
// D3, D4, R6.2): one scope only, and the only such key of the organisation.
import { describe, expect, it, vi } from "vitest";
import { authenticate, getDocument, issueToken } from "@/test/gateway-api";
import {
  buildWorld,
  call,
  CLIENT_ID,
  DOC_ID,
  json,
  KEY,
  READ_LIMIT,
  TENANT,
} from "@/test/gateway-world";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);
const other = (over: Record<string, unknown> = {}) => ({
  id: "client-9",
  name: "Second AV",
  tenant_id: TENANT,
  scopes: ["scan"],
  revoked_at: null,
  expires_at: null,
  key_hash: "other",
  ...over,
});
const scanCall = () => authenticate(call("GET", `/document/${DOC_ID}`), "scan");

describe("processing keys", () => {
  it("the organisation's only scanner is let in", async () => {
    await buildWorld({ scopes: ["scan"] });
    const ctx = await scanCall();
    expect(ctx).not.toBeInstanceOf(Response);
    expect(!(ctx instanceof Response) && ctx.clientId).toBe(CLIENT_ID);
  });
  it("a scanner key cannot read documents", async () => {
    await buildWorld({ scopes: ["scan"] });
    const res = await getDocument(call("GET", `/document/${DOC_ID}`), DOC_ID);
    expect(res.status).toBe(403);
    expect((await json(res))["code"]).toBe("scopeMissing");
  });
  it("a key that mixes a processing scope with others is refused for everything (made before D4)", async () => {
    const db = await buildWorld({ scopes: ["scan", "read"] });
    const res = await getDocument(call("GET", `/document/${DOC_ID}`), DOC_ID);
    expect(res.status).toBe(403);
    expect((await json(res))["code"]).toBe("notDesignated");
    expect(db.rows("document_events")).toEqual([]);
  });
  it("with two active scanners (made before the database index) neither is let in", async () => {
    const db = await buildWorld({ scopes: ["scan"] });
    db.rows("integration_clients").push(other());
    const res = await scanCall();
    expect(res).toBeInstanceOf(Response);
    expect(res instanceof Response && res.status).toBe(403);
  });
  it.each([
    ["disconnected", { revoked_at: "2026-11-01T00:00:00Z" }],
    ["expired", { expires_at: "2026-01-01T00:00:00Z" }],
    ["in another organisation", { tenant_id: "tenant-b" }],
    ["a reader", { scopes: ["extract"] }],
  ])("a second scanner that is %s does not get in the way", async (_n, over) => {
    const db = await buildWorld({ scopes: ["scan"] });
    db.rows("integration_clients").push(other(over));
    expect(await scanCall()).not.toBeInstanceOf(Response);
  });
  it("answers 503, not a pass, when the keys cannot be read", async () => {
    const db = await buildWorld({ scopes: ["scan"] });
    const real = db.from.bind(db);
    let reads = 0;
    db.from = ((t: string) => {
      if (t === "integration_clients" && ++reads > 1) db.fail("integration_clients", "select");
      return real(t);
    }) as typeof db.from;
    const res = await scanCall();
    expect(res instanceof Response && res.status).toBe(503);
  });
  it("a refused processing key still uses up its allowance", async () => {
    const db = await buildWorld({ scopes: ["scan", "read"], hits: READ_LIMIT + 1 });
    const res = await getDocument(call("GET", `/document/${DOC_ID}`), DOC_ID);
    expect(res.status).toBe(429);
    expect(db.rows("integration_clients")[0]!["last_rate_limited_at"]).toBeTruthy();
  });
  it("a processing key that is not the organisation's connected system gets no token", async () => {
    const db = await buildWorld({ scopes: ["scan"] });
    db.rows("integration_clients").push(other());
    const form = new URLSearchParams({ grant_type: "client_credentials", client_secret: KEY });
    const res = await issueToken(
      new Request("https://app.example.test/api/public/tmf-api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }),
    );
    expect(res.status).toBe(401);
    expect(db.rows("integration_tokens")).toEqual([]);
  });
});
