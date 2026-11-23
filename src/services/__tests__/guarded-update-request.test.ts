// The attempt guard is only as good as the request supabase-js really sends: FakeDb understanding
// `col->>key` proves nothing about PostgREST. This sends updateDocumentIf through the real client with
// a stubbed fetch and checks the query string (file-hooks spec, BR-154).
// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { updateDocumentIf } from "@/services/document-update";
import type { Db } from "@/services/seam-runtime";

function client(urls: string[]): Db {
  return createClient("https://db.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: RequestInfo | URL) => {
        urls.push(String(input instanceof Request ? input.url : input));
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  }) as unknown as Db;
}
const query = (url: string) => decodeURIComponent(new URL(url).search);

describe("guarded document update request", () => {
  it("compares the stored attempt as jsonb text", async () => {
    const urls: string[] = [];
    await updateDocumentIf(
      client(urls),
      {
        id: "d1",
        tenantId: "t1",
        expect: {
          pipeline_state: "scanning",
          current_version_id: "v1",
          "pipeline_detail->>attempt": "3",
        },
      },
      { pipeline_state: "reading" },
      "test",
    );
    const q = query(urls[0]!);
    expect(q).toContain("pipeline_detail->>attempt=eq.3");
    expect(q).toContain("pipeline_state=eq.scanning");
    expect(q).toContain("current_version_id=eq.v1");
    expect(q).toContain("tenant_id=eq.t1");
  });
  it("expects a missing attempt as is.null", async () => {
    const urls: string[] = [];
    await updateDocumentIf(
      client(urls),
      { id: "d1", tenantId: "t1", expect: { "pipeline_detail->>attempt": null } },
      { pipeline_state: "reading" },
      "test",
    );
    expect(query(urls[0]!)).toContain("pipeline_detail->>attempt=is.null");
  });
  it("reports no change when no row matched", async () => {
    const urls: string[] = [];
    const ok = await updateDocumentIf(
      client(urls),
      { id: "d1", tenantId: "t1", expect: { pipeline_state: "scanning" } },
      { pipeline_state: "reading" },
      "test",
    );
    expect(ok).toBe(false);
  });
});
