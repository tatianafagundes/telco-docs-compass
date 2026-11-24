// QA, adversarial: the routes of the file-results endpoints and their legacy twins
// (documentManagement/v4). Each route is called through its own handler, the way the server calls it:
// the twins must reach the same gateway function with the same params and differ only by the
// deprecation headers; a wrong method is 405 with Allow; the route tree lists every address.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sha256Bytes } from "@/services/gateway-create-input";
import {
  buildWorld,
  BASE,
  CLIENT_ID,
  DOC_ID,
  docRow,
  IDEM_KEY,
  json,
  KEY,
  TENANT,
} from "@/test/gateway-world";
import { Route as ScanNew } from "@/routes/api/public/tmf-api/document/v4/document.$id.attachment.$attachmentId.scanResult";
import { Route as ScanOld } from "@/routes/api/public/tmf-api/documentManagement/v4/document.$id.attachment.$attachmentId.scanResult";
import { Route as ReadNew } from "@/routes/api/public/tmf-api/document/v4/document.$id.attachment.$attachmentId.extractionResult";
import { Route as ReadOld } from "@/routes/api/public/tmf-api/documentManagement/v4/document.$id.attachment.$attachmentId.extractionResult";
import { Route as UpNew } from "@/routes/api/public/tmf-api/document/v4/document.$id.attachment.$attachmentId.uploaded";
import { Route as UpOld } from "@/routes/api/public/tmf-api/documentManagement/v4/document.$id.attachment.$attachmentId.uploaded";
import { Route as ContentNew } from "@/routes/api/public/tmf-api/document/v4/document.$id.attachment.$attachmentId.content";
import { Route as ContentOld } from "@/routes/api/public/tmf-api/documentManagement/v4/document.$id.attachment.$attachmentId.content";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);
const V = "33333333-3333-4333-8333-333333333333";
const BYTES = new TextEncoder().encode("%PDF-1.7 qa routes") as Uint8Array<ArrayBuffer>;
type Handler = (a: {
  request: Request;
  params: Record<string, string>;
}) => Response | Promise<Response>;
const handlers = (r: unknown) =>
  (r as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers;
const ROUTES = [
  ["scanResult", ScanNew, ScanOld],
  ["extractionResult", ReadNew, ReadOld],
  ["uploaded", UpNew, UpOld],
] as const;
const root = resolve(__dirname, "../../..");
const dir = (twin: "document" | "documentManagement") =>
  `${root}/routes/api/public/tmf-api/${twin}/v4`;

async function world(scopes: string[], state: string, detail: unknown, hash: string) {
  const db = await buildWorld({
    scopes,
    documents: [
      docRow({
        current_version_id: V,
        pipeline_state: state,
        pipeline_detail: detail,
        registered_by_client: CLIENT_ID,
      }),
    ],
  });
  db.tables["document_versions"] = [
    {
      id: V,
      document_id: DOC_ID,
      tenant_id: TENANT,
      storage_path: `${TENANT}/${V}`,
      content_hash: hash,
      size_bytes: BYTES.byteLength,
    },
  ];
  db.objects.set(`documents/${TENANT}/${V}`, BYTES);
  return db;
}
const req = (kind: string, base: string, body?: unknown) =>
  new Request(`${BASE.replace("/document/v4", base)}/document/${DOC_ID}/attachment/${V}/${kind}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "idempotency-key": IDEM_KEY,
      "content-type": "application/json",
    },
    body: body === undefined ? null : JSON.stringify(body),
  });

describe("every address is a file, a route and a tree entry", () => {
  for (const [kind] of ROUTES)
    for (const twin of ["document", "documentManagement"] as const) {
      const file = `document.$id.attachment.$attachmentId.${kind}.ts`;
      it(`${twin}/v4/${file}`, () => {
        const src = readFileSync(`${dir(twin)}/${file}`, "utf8");
        // The id string in createFileRoute is the address; a typo here is a route nobody can call.
        expect(src).toContain(
          `/api/public/tmf-api/${twin}/v4/document/$id/attachment/$attachmentId/${kind}"`,
        );
        // Params go in the order the gateway functions take them (request, id, versionId).
        expect(src).toMatch(/\(request, params\.id, params\.attachmentId\)/);
        expect(readFileSync(`${root}/routeTree.gen.ts`, "utf8")).toContain(
          `${twin}/v4/${file.replace(".ts", "")}'`,
        );
        expect(src.includes("legacy(")).toBe(twin === "documentManagement");
      });
    }
});

describe("the twins answer the same, the legacy one marked deprecated", () => {
  const DETAIL = (step: string) => ({
    mode: "external",
    by: "Order care",
    byClient: CLIENT_ID,
    step,
    attempt: 3,
    quarantinedVersions: [],
  });
  it.each([
    [
      "scanResult",
      ["scan"],
      "scanning",
      DETAIL("scan"),
      (h: string) => ({ result: "error", contentHash: h, attempt: 3, engine: "AV" }),
      "failed",
    ],
    [
      "extractionResult",
      ["extract"],
      "reading",
      DETAIL("read"),
      () => ({ result: "unreadable", attempt: 3 }),
      "failed",
    ],
    ["uploaded", ["register"], "uploading", null, () => undefined, "ready"],
  ])("%s", async (kind, scopes, state, detail, body, after) => {
    const hex = await sha256Bytes(BYTES);
    const pair = ROUTES.find((r) => r[0] === kind)!;
    const out: { status: number; body: unknown; headers: Headers }[] = [];
    for (const [route, base] of [
      [pair[1], "/api/public/tmf-api/document/v4"],
      [pair[2], "/api/public/tmf-api/documentManagement/v4"],
    ] as const) {
      const db = await world(scopes, state, detail, `sha256:${hex}`);
      const res = await handlers(route)["POST"]!({
        request: new Request(
          `https://app.example${base}/document/${DOC_ID}/attachment/${V}/${kind}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${KEY}`,
              "idempotency-key": IDEM_KEY,
              "content-type": "application/json",
            },
            body: body(hex) === undefined ? null : JSON.stringify(body(hex)),
          },
        ),
        params: { id: DOC_ID, attachmentId: V },
      });
      out.push({ status: res.status, headers: res.headers, body: await json(res.clone()) });
      expect(db.rows("documents")[0]!["pipeline_state"]).toBe(after);
    }
    expect(out[0]!.status).toBe(200);
    expect(out[1]!.status).toBe(out[0]!.status);
    const strip = (b: unknown) => ({ ...(b as object), requestId: undefined });
    expect(strip(out[1]!.body)).toEqual(strip(out[0]!.body));
    expect(out[0]!.headers.get("Deprecation")).toBeNull();
    expect(out[1]!.headers.get("Deprecation")).toBe("true");
    expect(out[1]!.headers.get("Sunset")).toBeTruthy();
    expect(out[1]!.headers.get("Link")).toContain("successor-version");
  });
  it("a refusal on the legacy twin is marked deprecated too", async () => {
    await world(["scan"], "ready", null, "sha256:" + "0".repeat(64));
    const res = await handlers(ScanOld)["POST"]!({
      request: req("scanResult", "/api/public/tmf-api/documentManagement/v4", {
        result: "error",
        contentHash: "a".repeat(64),
        attempt: 3,
        engine: "AV",
      }),
      params: { id: DOC_ID, attachmentId: V },
    });
    expect(res.status).toBe(409);
    expect(res.headers.get("Deprecation")).toBe("true");
  });
  it("the download twins reach the same rule: a scanner's download writes the same receipt", async () => {
    for (const [route, base] of [
      [ContentNew, "/api/public/tmf-api/document/v4"],
      [ContentOld, "/api/public/tmf-api/documentManagement/v4"],
    ] as const) {
      const db = await world(["scan"], "scanning", DETAIL("scan"), "sha256:x");
      const res = await handlers(route)["GET"]!({
        request: new Request(
          `https://app.example${base}/document/${DOC_ID}/attachment/${V}/content`,
          {
            headers: { authorization: `Bearer ${KEY}` },
          },
        ),
        params: { id: DOC_ID, attachmentId: V },
      });
      expect(res.status).toBe(200);
      expect(db.rows("document_events").map((e) => e["action"])).toEqual(["scanDownload"]);
    }
  });
});

describe("other methods", () => {
  it.each(
    ROUTES.flatMap(
      ([k, a, b]) =>
        [
          [k, "new", a],
          [k, "legacy", b],
        ] as const,
    ),
  )("%s (%s): GET, PUT, PATCH and DELETE are 405 with Allow: POST", async (_k, _t, route) => {
    const h = handlers(route);
    for (const m of ["GET", "PUT", "PATCH", "DELETE"]) {
      const res = await h[m]!({
        request: new Request("https://app.example/x", { method: m }),
        params: {},
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
      expect(h["POST"]).toBeTypeOf("function");
    }
  });
  it("the content route allows GET only, on both addresses", async () => {
    for (const route of [ContentNew, ContentOld]) {
      const h = handlers(route);
      for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await h[m]!({
          request: new Request("https://app.example/x", { method: m }),
          params: {},
        });
        expect(res.status).toBe(405);
        expect(res.headers.get("Allow")).toBe("GET");
      }
    }
  });
});
