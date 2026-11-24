// Characterisation of the OAuth client-credentials endpoint: a system key is swapped for a
// short-lived bearer token with the same permissions, and that token works like the key.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWorld, call, CLIENT_ID, DOC_ID, json, KEY } from "@/test/gateway-world";
import { getDocument, issueToken } from "@/test/gateway-api";
import { sha256Hex } from "@/services/tmf667-mapper";
import {
  MAX_ACTIVE_TOKENS,
  TOKEN_REQUESTS_PER_ADDRESS_PER_MINUTE,
  TOKEN_REQUESTS_PER_SYSTEM_PER_MINUTE,
  tokenLimiters,
} from "@/services/gateway-token";

vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

beforeEach(() => {
  tokenLimiters.byAddress.reset();
  tokenLimiters.bySystem.reset();
});
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
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
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
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
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

describe("limits on asking for tokens", () => {
  const ask = (headers: Record<string, string> = {}, secret = KEY) =>
    issueToken(form({ grant_type: "client_credentials", client_secret: secret }, headers));
  const from = (ip: string) => ({ "cf-connecting-ip": ip });

  it("answers 429 temporarily_unavailable with Retry-After after too many requests from one address", async () => {
    await buildWorld();
    for (let i = 0; i < TOKEN_REQUESTS_PER_ADDRESS_PER_MINUTE; i++)
      expect((await ask(from("203.0.113.9"), "erad_" + "z".repeat(24))).status).toBe(401);
    const res = await ask(from("203.0.113.9"));
    expect(res.status).toBe(429);
    expect((await json(res))["error"]).toBe("temporarily_unavailable");
    expect(res.headers.get("Retry-After")).toBe("60");
  });
  it("counts wrong keys too, so a key cannot be guessed at speed", async () => {
    await buildWorld();
    const wrong = "erad_" + "y".repeat(24);
    for (let i = 0; i < TOKEN_REQUESTS_PER_ADDRESS_PER_MINUTE; i++)
      await ask(from("203.0.113.9"), wrong);
    // Even the right key is refused from that address until the minute is over.
    expect((await ask(from("203.0.113.9"))).status).toBe(429);
  });
  it("does not let the caller choose its budget with X-Forwarded-For", async () => {
    await buildWorld();
    let last = 0;
    for (let i = 0; i <= TOKEN_REQUESTS_PER_ADDRESS_PER_MINUTE; i++)
      last = (await ask({ "x-forwarded-for": `203.0.113.${i}` }, "erad_" + "z".repeat(24))).status;
    expect(last).toBe(429);
  });
  it("keeps the budget of one address apart from another", async () => {
    const db = await buildWorld();
    for (let i = 0; i < TOKEN_REQUESTS_PER_ADDRESS_PER_MINUTE + 1; i++) {
      db.tables["integration_tokens"] = []; // keep the cap on live tokens out of this test
      await ask(from("203.0.113.9"));
    }
    db.tables["integration_tokens"] = [];
    expect((await ask(from("198.51.100.4"))).status).toBe(200);
  });
  it("limits one system across addresses", async () => {
    await buildWorld();
    const db = (await import("@/test/gateway-world")).holder.db;
    let last = 200;
    for (let i = 0; i < TOKEN_REQUESTS_PER_SYSTEM_PER_MINUTE + 1; i++) {
      db.tables["integration_tokens"] = [];
      last = (await ask(from(`192.0.2.${i + 1}`))).status;
    }
    expect(last).toBe(429);
  });
  it("refuses a new token when the system already holds the most it may, and says to reuse one", async () => {
    const db = await buildWorld();
    const future = new Date(Date.now() + 600_000).toISOString();
    db.tables["integration_tokens"] = Array.from({ length: MAX_ACTIVE_TOKENS }, (_, i) => ({
      client_id: CLIENT_ID,
      token_hash: `t${i}`,
      expires_at: future,
    }));
    const res = await ask();
    expect(res.status).toBe(429);
    expect(String((await json(res))["error_description"])).toContain("Reuse");
    expect(db.rows("integration_tokens")).toHaveLength(MAX_ACTIVE_TOKENS);
  });
  it("does not count tokens that have expired or belong to another system", async () => {
    const db = await buildWorld();
    const future = new Date(Date.now() + 600_000).toISOString();
    const past = new Date(Date.now() - 600_000).toISOString();
    db.tables["integration_tokens"] = [
      ...Array.from({ length: MAX_ACTIVE_TOKENS }, (_, i) => ({
        client_id: CLIENT_ID,
        token_hash: `e${i}`,
        expires_at: past,
      })),
      ...Array.from({ length: MAX_ACTIVE_TOKENS }, (_, i) => ({
        client_id: "other",
        token_hash: `o${i}`,
        expires_at: future,
      })),
    ];
    expect((await ask()).status).toBe(200);
  });
  it("hands out no token when the database fails while counting them", async () => {
    const db = await buildWorld();
    db.fail("integration_tokens", "select");
    await expect(ask()).rejects.toThrow("database error");
    expect(db.rows("integration_tokens")).toEqual([]);
  });
});
