// Signs in as each demo account against the real backend and checks what the access rules allow.
// Runs only when RUN_ACCESS_TESTS=1 so ordinary unit runs stay offline.
import { describe, expect, it } from "vitest";

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const PASSWORD = "AuroraTest123!";
const enabled = process.env.RUN_ACCESS_TESTS === "1" && Boolean(URL_ && KEY);

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

async function rows(email: string, path: string): Promise<Record<string, unknown>[]> {
  const t = await token(email);
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY ?? "", Authorization: `Bearer ${t}` } });
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error(`query failed: ${JSON.stringify(body)}`);
  return body as Record<string, unknown>[];
}

const ids = (r: Record<string, unknown>[], k = "id") => r.map((x) => String(x[k])).sort();

describe.runIf(enabled)("access rules", () => {
  it("should show the Sweden manager all 11 Sweden records and no Norway records", async () => {
    const r = await rows("se.manager@example.test", "business_entities?select=id,tenant_id");
    expect(r).toHaveLength(11);
    expect(r.every((x) => x.tenant_id === "aurora-se")).toBe(true);
  });

  it("should show the Sweden admin every Sweden record", async () => {
    const r = await rows("se.admin@example.test", "business_entities?select=id,tenant_id");
    expect(r).toHaveLength(11);
  });

  it("should limit the Sweden viewer to order ord-se-7731", async () => {
    expect(ids(await rows("se.viewer@example.test", "business_entities?select=id"))).toEqual(["ord-se-7731"]);
  });

  it("should never show Sweden documents to the Norway manager", async () => {
    const docs = await rows("no.manager@example.test", "documents?select=id,tenant_id");
    expect(docs.length).toBe(3);
    expect(docs.every((d) => d.tenant_id === "aurora-no")).toBe(true);
    expect(await rows("no.manager@example.test", "business_entities?select=id&tenant_id=eq.aurora-se")).toEqual([]);
  });

  it("should give the master admin no tenant records", async () => {
    expect(await rows("master.admin@example.test", "business_entities?select=id")).toEqual([]);
    expect(await rows("master.admin@example.test", "documents?select=id")).toEqual([]);
  });

  it("should refuse direct document edits from any signed-in account", async () => {
    const t = await token("se.admin@example.test");
    const res = await fetch(`${URL_}/rest/v1/documents?tenant_id=eq.aurora-se`, {
      method: "PATCH",
      headers: { apikey: KEY ?? "", Authorization: `Bearer ${t}`, "content-type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ name: "tampered" }),
    });
    const body: unknown = await res.json();
    expect(Array.isArray(body) ? body.length : 0).toBe(0);
  });
});
