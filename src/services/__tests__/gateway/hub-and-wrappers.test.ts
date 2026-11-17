// Characterisation of the event hub (subscribe, unsubscribe) and of the small wrappers that give
// every unsupported method or path a JSON answer instead of the app's HTML page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_SCOPES,
  buildWorld,
  call,
  CLIENT_ID,
  json,
  OTHER_CLIENT_ID,
} from "@/test/gateway-world";
import { legacy, otherMethods, subscribe, unknownPath, unsubscribe } from "@/test/gateway-api";
import { LEGACY_SUNSET, TMF_BASE_PATH } from "@/services/tmf667-mapper";

vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const SUB_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_SUB_ID = "55555555-5555-4555-8555-555555555555";
const CALLBACK = "https://hooks.example.com/in";

/** The name of any host resolves to one public address; the lookups are not the point here. */
function publicDns() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const type = new URL(url).searchParams.get("type");
      const answer = type === "A" ? [{ type: 1, data: "93.184.216.34" }] : [];
      return new Response(JSON.stringify({ Answer: answer }));
    }),
  );
}
beforeEach(publicDns);
afterEach(() => vi.unstubAllGlobals());

const subscribeWith = (body: unknown) => subscribe(call("POST", "/hub", { body }));

describe("subscribing to events", () => {
  it("creates a subscription for this system and shows the signing secret once", async () => {
    const db = await buildWorld();
    db.tables["event_subscriptions"] = [];
    const res = await subscribeWith({ callback: CALLBACK, query: "eventType=DocumentCreateEvent" });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({
      callback: CALLBACK,
      query: "eventType=DocumentCreateEvent",
      "@type": "EventSubscription",
    });
    expect(String(body["signingSecret"])).toMatch(/^[0-9a-f]{64}$/);
    // What is stored is pinned to this system and tenant, with the same secret.
    const stored = db.rows("event_subscriptions")[0];
    expect(stored).toMatchObject({
      client_id: CLIENT_ID,
      tenant_id: "tenant-a",
      callback: CALLBACK,
    });
    expect(stored?.["secret"]).toBe(body["signingSecret"]);
  });

  it("gives every subscription its own secret", async () => {
    await buildWorld();
    const a = await json(await subscribeWith({ callback: CALLBACK }));
    const b = await json(await subscribeWith({ callback: CALLBACK }));
    expect(a["signingSecret"]).not.toBe(b["signingSecret"]);
  });

  it.each([
    ["no callback", {}],
    ["a callback that is not a URL", { callback: "not a url" }],
    ["a callback that is not https", { callback: "http://hooks.example.com/in" }],
    ["a callback on this machine", { callback: "https://localhost/in" }],
    ["a callback with a private address", { callback: "https://10.0.0.5/in" }],
    [
      "a callback longer than 500 characters",
      { callback: "https://hooks.example.com/" + "a".repeat(500) },
    ],
    ["a query longer than 300 characters", { callback: CALLBACK, query: "q".repeat(301) }],
  ])("answers 400 invalidCallback for %s and stores nothing", async (_name, body) => {
    const db = await buildWorld();
    const res = await subscribeWith(body);
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("invalidCallback");
    expect(db.writesTo("event_subscriptions")).toHaveLength(0);
  });

  it("refuses a name that points to a private address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ Answer: [{ type: 1, data: "10.1.2.3" }] }))),
    );
    const db = await buildWorld();
    const res = await subscribeWith({ callback: CALLBACK });
    expect(res.status).toBe(400);
    expect(db.writesTo("event_subscriptions")).toHaveLength(0);
  });

  it("answers 503 when the subscription cannot be saved", async () => {
    const db = await buildWorld();
    db.fail("event_subscriptions", "insert", "disk full");
    const res = await subscribeWith({ callback: CALLBACK });
    expect(res.status).toBe(503);
    expect((await json(res))["code"]).toBe("unavailable");
  });

  it("needs the subscribe scope", async () => {
    await buildWorld({ scopes: ALL_SCOPES.filter((s) => s !== "subscribe") });
    expect((await subscribeWith({ callback: CALLBACK })).status).toBe(403);
  });

  it("answers 400 invalidJson for a body that is not JSON", async () => {
    await buildWorld();
    const req = new Request(`https://app.example/api/public/tmf-api/document/v4/hub`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${"erad_" + "k".repeat(24)}`,
        "content-type": "application/json",
      },
      body: "{oops",
    });
    const res = await subscribe(req);
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("invalidJson");
  });
});

describe("unsubscribing", () => {
  const seed = async () => {
    const db = await buildWorld();
    db.tables["event_subscriptions"] = [
      { id: SUB_ID, client_id: CLIENT_ID, tenant_id: "tenant-a", callback: CALLBACK },
      { id: OTHER_SUB_ID, client_id: OTHER_CLIENT_ID, tenant_id: "tenant-a", callback: CALLBACK },
    ];
    return db;
  };
  const remove = (id: string) => unsubscribe(call("DELETE", `/hub/${id}`), id);

  it("removes this system's own subscription", async () => {
    const db = await seed();
    const res = await remove(SUB_ID);
    expect(res.status).toBe(204);
    expect(db.rows("event_subscriptions").map((r) => r["id"])).toEqual([OTHER_SUB_ID]);
  });

  it("answers 404 for another system's subscription, and leaves it alone", async () => {
    const db = await seed();
    const res = await remove(OTHER_SUB_ID);
    expect(res.status).toBe(404);
    expect((await json(res))["code"]).toBe("notFound");
    expect(db.rows("event_subscriptions")).toHaveLength(2);
  });

  it.each(["not-an-id", "66666666-6666-4666-8666-666666666666"])(
    "answers 404 for %s",
    async (id) => {
      await seed();
      expect((await remove(id)).status).toBe(404);
    },
  );
});

describe("unsupported methods and paths still answer in JSON", () => {
  it("answers 405 with an Allow header for each method that is not allowed", async () => {
    const handlers = otherMethods(["GET", "POST"]);
    expect(Object.keys(handlers).sort()).toEqual(["DELETE", "PATCH", "PUT"]);
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const res = handlers[method]!();
      expect(res.status, method).toBe(405);
      expect(res.headers.get("Allow"), method).toBe("GET, POST");
      const body = await json(res);
      expect(body["code"]).toBe("methodNotAllowed");
      expect(body["message"]).toBe("Use GET or POST here.");
    }
  });

  it("leaves nothing to answer for the methods that are allowed", () => {
    expect(Object.keys(otherMethods(["GET", "POST", "PUT", "PATCH", "DELETE"]))).toEqual([]);
  });

  it("answers 404 in the standard error shape for an unknown path", async () => {
    const res = unknownPath();
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ code: "notFound", "@type": "Error" });
    expect(res.headers.get("X-Request-ID")).toBeTruthy();
  });

  it("marks the answers of the earlier address as deprecated and points at its successor", async () => {
    const res = legacy(unknownPath());
    expect(res.status).toBe(404); // the answer itself is unchanged
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Sunset")).toBe(LEGACY_SUNSET);
    expect(res.headers.get("Link")).toBe(`<${TMF_BASE_PATH}>; rel="successor-version"`);
  });
});
