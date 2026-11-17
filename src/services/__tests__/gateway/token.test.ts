// Characterisation of the OAuth client-credentials endpoint: a system key is swapped for a
// short-lived bearer token with the same permissions, and that token works like the key.
import { describe, expect, it, vi } from "vitest";
import { buildWorld, call, CLIENT_ID, DOC_ID, json, KEY } from "@/test/gateway-world";
import { getDocument, issueToken } from "@/test/gateway-api";
import { sha256Hex } from "@/services/tmf667-mapper";

vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const TOKEN_URL = "https://app.example/api/public/tmf-api/oauth/token";
const form = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
const basic = (user: string, secret: string) => "Basic " + btoa(`${user}:${secret}`);

describe("asking for a token", () => {
  it("swaps a valid key for a 15-minute bearer token with the key's permissions", async () => {
    const db = await buildWorld({ scopes: ["read", "hold"] });
    const res = await issueToken(form({ grant_type: "client_credentials", client_secret: KEY }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Pragma")).toBe("no-cache");
    const body = await json(res);
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 900, scope: "read hold" });
    expect(String(body["access_token"])).toMatch(/^eradt_[0-9a-f]{64}$/);
    // Only the hash is stored, tied to this system, and it expires in about 15 minutes.
    const stored = db.rows("integration_tokens");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.["token_hash"]).toBe(await sha256Hex(String(body["access_token"])));
    expect(JSON.stringify(stored)).not.toContain(String(body["access_token"]));
    expect(stored[0]?.["client_id"]).toBe(CLIENT_ID);
    const seconds = (Date.parse(String(stored[0]?.["expires_at"])) - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(890);
    expect(seconds).toBeLessThanOrEqual(900);
  });

  it("accepts the key as the password of HTTP Basic, and as a JSON body", async () => {
    await buildWorld();
    const viaBasic = await issueToken(
      form({ grant_type: "client_credentials" }, { authorization: basic("client", KEY) }),
    );
    expect(viaBasic.status).toBe(200);
    const viaJson = await issueToken(
      new Request(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_secret: KEY }),
      }),
    );
    expect(viaJson.status).toBe(200);
  });

  it("leaves removing expired tokens to the scheduled housekeeping", async () => {
    const db = await buildWorld();
    db.tables["integration_tokens"] = [
      { client_id: CLIENT_ID, token_hash: "old", expires_at: "2026-01-01T00:00:00Z" },
    ];
    await issueToken(form({ grant_type: "client_credentials", client_secret: KEY }));
    expect(db.rows("integration_tokens").map((t) => t["token_hash"])).toContain("old");
  });

  it.each([
    [
      "another grant type",
      { grant_type: "password", client_secret: KEY },
      400,
      "unsupported_grant_type",
    ],
    ["no grant type", { client_secret: KEY }, 400, "unsupported_grant_type"],
    ["no key", { grant_type: "client_credentials" }, 401, "invalid_client"],
    [
      "a key of the wrong shape",
      { grant_type: "client_credentials", client_secret: "nope" },
      401,
      "invalid_client",
    ],
    [
      "a key nobody holds",
      { grant_type: "client_credentials", client_secret: "erad_" + "z".repeat(24) },
      401,
      "invalid_client",
    ],
  ])("refuses %s", async (_name, fields, status, error) => {
    const db = await buildWorld();
    const res = await issueToken(form(fields));
    expect(res.status).toBe(status);
    expect((await json(res))["error"]).toBe(error);
    expect(db.rows("integration_tokens")).toHaveLength(0);
  });

  it("refuses a key that was disconnected or has expired", async () => {
    await buildWorld({ client: { revoked_at: "2026-11-02T00:00:00Z" } });
    expect(
      (await issueToken(form({ grant_type: "client_credentials", client_secret: KEY }))).status,
    ).toBe(401);
    await buildWorld({ client: { expires_at: "2026-01-01T00:00:00Z" } });
    expect(
      (await issueToken(form({ grant_type: "client_credentials", client_secret: KEY }))).status,
    ).toBe(401);
  });

  it("refuses a request over 4,000 characters", async () => {
    await buildWorld();
    const res = await issueToken(
      form({ grant_type: "client_credentials", client_secret: KEY, pad: "x".repeat(4000) }),
    );
    expect(res.status).toBe(400);
    expect((await json(res))["error"]).toBe("invalid_request");
  });
});

describe("using the token", () => {
  const withToken = async (extra: Record<string, unknown> = {}) => {
    const db = await buildWorld();
    const res = await issueToken(form({ grant_type: "client_credentials", client_secret: KEY }));
    const token = String((await json(res))["access_token"]);
    Object.assign(db.rows("integration_tokens")[0] ?? {}, extra);
    return token;
  };
  const read = (token: string) =>
    getDocument(call("GET", `/document/${DOC_ID}`, { key: token }), DOC_ID);

  it("works like the key it came from", async () => {
    expect((await read(await withToken())).status).toBe(200);
  });

  it("stops working when it expires", async () => {
    const token = await withToken({ expires_at: "2026-01-01T00:00:00Z" });
    expect((await read(token)).status).toBe(401);
  });

  it("stops working when the key it came from is disconnected", async () => {
    const token = await withToken();
    const db = (await import("@/test/gateway-world")).holder.db;
    db.rows("integration_clients")[0]!["revoked_at"] = "2026-11-02T00:00:00Z";
    expect((await read(token)).status).toBe(401);
  });

  it("is not accepted if nobody issued it", async () => {
    await buildWorld();
    expect((await read("eradt_" + "a".repeat(64))).status).toBe(401);
  });
});
