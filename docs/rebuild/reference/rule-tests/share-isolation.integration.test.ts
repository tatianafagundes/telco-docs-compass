// Data-level regression for the Sweden quote: the Norway manager must not read any part of it.
// Runs only when RUN_ACCESS_TESTS=1. The share/remove flow itself is covered by e2e/share-isolation.py,
// because shares can only be changed through the app (direct table writes are refused).
import { describe, expect, it } from "vitest";

const URL_ = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const KEY = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;
const PASSWORD = process.env["DEMO_PASSWORD"] ?? "";
const enabled = process.env["RUN_ACCESS_TESTS"] === "1" && Boolean(URL_ && KEY && PASSWORD);

const QUOTE_RECORD = "quo-se-0412";
const QUOTE_DOC = "00000000-0000-0000-0000-0000000000d2";
const LEAKS = ["Q-2026-0412", "480 lines", "5G backup", "aurora-se"];

async function token(email: string): Promise<string> {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`sign-in failed for ${email}`);
  return body.access_token;
}

async function raw(t: string, path: string): Promise<string> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY ?? "", Authorization: `Bearer ${t}` } });
  return res.text();
}

describe.runIf(enabled)("Sweden quote isolation from Norway", () => {
  const reads: [string, string][] = [
    ["record", `business_entities?select=*&id=eq.${QUOTE_RECORD}`],
    ["document", `documents?select=*&id=eq.${QUOTE_DOC}`],
    ["versions", `document_versions?select=*&document_id=eq.${QUOTE_DOC}`],
    ["details", `extraction_fields?select=*&document_id=eq.${QUOTE_DOC}`],
    ["activity", `document_events?select=*&document_id=eq.${QUOTE_DOC}`],
    ["record links", `document_relations?select=*&document_id=eq.${QUOTE_DOC}`],
    ["shares", `document_access_exceptions?select=*&document_id=eq.${QUOTE_DOC}`],
    ["record access", `entity_access?select=*&entity_id=eq.${QUOTE_RECORD}`],
  ];

  for (const [label, path] of reads) {
    it(`should return no ${label} of the Sweden quote to the Norway manager`, async () => {
      const body = await raw(await token("no.manager@example.test"), path);
      expect(JSON.parse(body)).toEqual([]);
      for (const leak of LEAKS) expect(body).not.toContain(leak);
    });
  }

  it("should still let the Sweden manager read the quote, so the checks above are meaningful", async () => {
    const body = await raw(await token("se.manager@example.test"), `documents?select=id,name&id=eq.${QUOTE_DOC}`);
    expect(body).toContain("Q-2026-0412");
  });
});
