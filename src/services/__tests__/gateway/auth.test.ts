// Characterisation of authenticate() in the TMF gateway: what a connected system gets when its key
// is missing, wrong, revoked, expired, too weak or too busy. These tests pin today's behaviour so
// the gateway can be split without changing it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_SCOPES,
  buildWorld,
  call,
  CLIENT_ID,
  DOC_ID,
  json,
  KEY,
  OTHER_DOC_ID,
  READ_LIMIT,
  WRITE_LIMIT,
} from "@/test/gateway-world";
import { deleteDocument, getDocument, setLegalHold, subscribe } from "@/test/gateway-api";

vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const get = (over: Parameters<typeof call>[2] = {}) =>
  getDocument(call("GET", `/document/${DOC_ID}`, over), DOC_ID);
const del = () => deleteDocument(call("DELETE", `/document/${DOC_ID}`), DOC_ID);

describe("a system key is checked before anything else", () => {
  beforeEach(async () => {
    await buildWorld();
  });

  it("accepts a valid key", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-ID")).toBeTruthy();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    ["no Authorization header", null],
    ["a key without the erad_ prefix", "x".repeat(30)],
    ["a key that is too short", "erad_short"],
    ["a key with a character outside the allowed set", "erad_" + "k".repeat(23) + "!"],
    ["a well-formed key nobody holds", "erad_" + "z".repeat(24)],
  ])("answers 401 for %s", async (_name, key) => {
    const res = await get({ key });
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body["code"]).toBe("unauthorized");
    expect(body["@type"]).toBe("Error");
  });

  it("answers 401 for a key that was disconnected", async () => {
    await buildWorld({ client: { revoked_at: "2026-11-02T00:00:00Z" } });
    expect((await get()).status).toBe(401);
  });

  it("answers 401, with its own message, for a key that expired", async () => {
    await buildWorld({ client: { expires_at: "2026-01-01T00:00:00Z" } });
    const res = await get();
    expect(res.status).toBe(401);
    expect(String((await json(res))["message"])).toContain("expired");
  });

  it("accepts a key that expires in the future", async () => {
    await buildWorld({ client: { expires_at: "2099-01-01T00:00:00Z" } });
    expect((await get()).status).toBe(200);
  });
});

describe("a key may only do what its scopes allow", () => {
  it("answers 403 scopeMissing, naming the scope, when it is not granted", async () => {
    await buildWorld({ scopes: ["read"] });
    const res = await del();
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body["code"]).toBe("scopeMissing");
    expect(String(body["message"])).toContain("delete");
  });

  it("a read-only key can read", async () => {
    await buildWorld({ scopes: ["read"] });
    expect((await get()).status).toBe(200);
  });

  it.each([
    [
      "hold",
      () =>
        setLegalHold(
          call("POST", `/document/${DOC_ID}/legalHold`, { body: { active: true, reason: "x" } }),
          DOC_ID,
        ),
    ],
    ["delete", del],
    [
      "subscribe",
      () => subscribe(call("POST", "/hub", { body: { callback: "https://x.example/h" } })),
    ],
  ])("the %s operation asks for the %s scope", async (scope, run) => {
    await buildWorld({ scopes: ALL_SCOPES.filter((s) => s !== scope) });
    const res = await run();
    expect(res.status).toBe(403);
    expect(String((await json(res))["message"])).toContain(scope);
  });
});

describe("each system has its own allowance", () => {
  it("lets a request through when the count is exactly at the limit", async () => {
    await buildWorld({ hits: READ_LIMIT });
    expect((await get()).status).toBe(200);
  });

  it("answers 429 with the standard headers when the limit is passed", async () => {
    const db = await buildWorld({ hits: READ_LIMIT + 1 });
    const res = await get();
    expect(res.status).toBe(429);
    expect((await json(res))["code"]).toBe("tooManyRequests");
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("RateLimit-Limit")).toBe(String(READ_LIMIT));
    expect(res.headers.get("RateLimit-Remaining")).toBe("0");
    // The refusal is noted on the system, and the document is not read.
    expect(db.rows("integration_clients")[0]?.["last_rate_limited_at"]).toBeTruthy();
    expect(db.writesTo("document_events")).toHaveLength(0);
  });

  it("counts a change against the write allowance, which is lower", async () => {
    await buildWorld({ hits: WRITE_LIMIT });
    expect((await del()).status).toBe(204);
    await buildWorld({ hits: WRITE_LIMIT + 1 });
    expect((await del()).status).toBe(429);
  });

  it("asks the database for the count of this system only, by kind", async () => {
    const db = await buildWorld();
    const seen: Record<string, unknown>[] = [];
    db.onRpc("api_hit", (args: Record<string, unknown>) => {
      seen.push(args);
      return 1;
    });
    await get();
    await del();
    expect(seen).toEqual([
      { p_client: CLIENT_ID, p_kind: "read" },
      { p_client: CLIENT_ID, p_kind: "write" },
    ]);
  });
});

describe("a system only reaches its own tenant", () => {
  it("answers 404 for a document of another tenant, the same as for one that does not exist", async () => {
    await buildWorld();
    const missing = "33333333-3333-4333-8333-333333333333";
    // One after the other: concurrent dynamic imports race with the mock factory in vitest.
    const answers = [
      await getDocument(call("GET", `/document/${OTHER_DOC_ID}`), OTHER_DOC_ID),
      await getDocument(call("GET", `/document/${missing}`), missing),
      await getDocument(call("GET", "/document/not-an-id"), "not-an-id"),
    ];
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect((await json(res))["code"]).toBe("notFound");
    }
  });

  it("records the read in the activity of that document, naming the system", async () => {
    const db = await buildWorld();
    await get();
    const events = db.writesTo("document_events", "insert").flatMap((w) => w.rows);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "view", document_id: DOC_ID, actor: null });
    expect(String(events[0]?.["detail"])).toContain("Order care");
  });
});

describe("the key itself", () => {
  it("is never stored or compared by its value", async () => {
    const db = await buildWorld();
    await get();
    expect(JSON.stringify(db.rows("integration_clients"))).not.toContain(KEY);
  });
});
