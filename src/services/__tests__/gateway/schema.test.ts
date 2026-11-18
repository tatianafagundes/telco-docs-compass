// The schema the API points to in @schemaLocation must describe what the API really returns, and
// must not depend on anything outside the app.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildWorld, call, DOC_ID, docRow, json, TENANT } from "@/test/gateway-world";
import { getDocument } from "@/test/gateway-api";
import { ERAD_SCHEMA_PATH } from "@/services/tmf667-shared";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

type Schema = {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  pattern?: string;
  $ref?: string;
  definitions?: Record<string, Schema>;
};
const SCHEMA = JSON.parse(readFileSync(`public${ERAD_SCHEMA_PATH}`, "utf8")) as Schema;

/** Checks the parts of JSON Schema this file uses; returns the paths that do not fit. */
function problems(value: unknown, schema: Schema, path = "$"): string[] {
  if (schema.$ref)
    return problems(value, SCHEMA.definitions![schema.$ref.split("/").pop()!]!, path);
  const out: string[] = [];
  if (schema.const !== undefined && value !== schema.const)
    out.push(`${path}: not ${String(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value))
    out.push(`${path}: ${String(value)} not allowed`);
  if (schema.type === "string" && typeof value !== "string") out.push(`${path}: not a string`);
  if (schema.type === "boolean" && typeof value !== "boolean") out.push(`${path}: not a boolean`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value))
    out.push(`${path}: does not match ${schema.pattern}`);
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [...out, `${path}: not an array`];
    value.forEach((v, i) => out.push(...problems(v, schema.items ?? {}, `${path}[${i}]`)));
  }
  if (schema.properties || schema.required) {
    if (typeof value !== "object" || value === null) return [...out, `${path}: not an object`];
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in obj)) out.push(`${path}.${r}: missing`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (!sub) out.push(`${path}.${k}: not in the schema`);
      else out.push(...problems(v, sub, `${path}.${k}`));
    }
  }
  return out;
}

describe("the EradDocument schema", () => {
  it("does not point at anything outside itself", () => {
    const refs = JSON.stringify(SCHEMA).match(/"\$ref":"[^"]*"/g) ?? [];
    expect(refs.every((r) => r.startsWith('"$ref":"#/'))).toBe(true);
  });
  it("describes a full document as the API returns it", async () => {
    const db = await buildWorld({
      documents: [
        docRow({
          status: "effective",
          effective_date: "2026-11-01",
          expiry_date: "2027-11-01",
          legal_hold: true,
          external_identifier: [{ id: "ORD-1", owner: "crm", externalIdentifierType: "order" }],
          characteristic: [{ name: "counterparty", value: "Acme" }],
        }),
      ],
      specs: [{ code: "contract", name: "Contract", definition: { category: "Legal" } }],
    });
    db.tables["document_versions"] = [
      {
        id: "ver-1",
        document_id: DOC_ID,
        tenant_id: TENANT,
        label: "1",
        mime_type: "application/pdf",
        size_bytes: 10,
        content_hash: "a".repeat(64),
        created_at: "2026-11-01T10:00:00Z",
      },
    ];
    db.tables["document_relations"] = [
      {
        document_id: DOC_ID,
        entity_id: "e1",
        role: "contract",
        business_entities: { referred_type: "Agreement", tenant_id: TENANT },
      },
    ];
    const doc = await json(await getDocument(call("GET", `/document/${DOC_ID}`), DOC_ID));
    expect(String(doc["@schemaLocation"])).toContain(ERAD_SCHEMA_PATH);
    expect(problems(doc, SCHEMA)).toEqual([]);
  });
  it("describes a bare draft too", async () => {
    await buildWorld();
    const doc = await json(await getDocument(call("GET", `/document/${DOC_ID}`), DOC_ID));
    expect(problems(doc, SCHEMA)).toEqual([]);
  });
  it("catches a field the API returns that the schema does not list", () => {
    expect(
      problems({ ...{ id: "x" }, surprise: 1 }, { properties: { id: { type: "string" } } }),
    ).toEqual(["$.surprise: not in the schema"]);
  });
});
