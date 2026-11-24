// The details a reader proposes for a version (file-hooks spec R3.3, R3.4): the type's
// specification, saving the proposals, and taking them back when the document moved meanwhile.
import type { Json } from "@/integrations/supabase/types";
import type { AcceptedField, FieldSpec } from "@/services/file-hook-fields";
import { cleanLabel } from "@/services/file-hook-text";
import type { Target } from "@/services/file-result-target";
import type { SystemCtx } from "@/services/gateway-core";
import { DatabaseError, must } from "@/services/shared/must";

/**
 * The details of a document type a reader may fill, as stored in its specification. A database
 * error is thrown (answered 503 by the caller), never read as "no details": that would tell the
 * reader 400 unknownFields for a temporary fault.
 */
export async function fieldSpecs(ctx: SystemCtx, documentType: string): Promise<FieldSpec[]> {
  const data = must(
    await ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId }),
    "reading the specifications of the organisation",
  );
  const def = (data ?? []).find((s) => s.code === documentType)?.definition as
    { specCharacteristic?: unknown } | undefined;
  const list = Array.isArray(def?.specCharacteristic) ? def.specCharacteristic : [];
  return list.flatMap((c: unknown) => {
    const r = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
    if (typeof r["name"] !== "string") return [];
    return [
      {
        name: r["name"],
        ...(typeof r["valueType"] === "string" ? { valueType: r["valueType"] } : {}),
        ...(Array.isArray(r["enumValues"])
          ? { enumValues: r["enumValues"].filter((v): v is string => typeof v === "string") }
          : {}),
        ...(typeof r["reviewThreshold"] === "number"
          ? { reviewThreshold: r["reviewThreshold"] }
          : {}),
      },
    ];
  });
}

/**
 * Saves the reader's details as proposals a person checks (R3.4, BR-023). A detail a person already
 * has for this version keeps the person's value and is listed as skipped.
 */
export async function proposeFields(
  ctx: SystemCtx,
  t: Target,
  fields: readonly AcceptedField[],
): Promise<{ inserted: string[]; skipped: string[] }> {
  const existing = must(
    await ctx.admin
      .from("extraction_fields")
      .select("name")
      .eq("tenant_id", ctx.tenantId)
      .eq("document_id", t.doc.id)
      .eq("version_id", t.version.id),
    "reading the details of a version",
  );
  const taken = new Set((existing ?? []).map((r) => r.name));
  const skipped = fields.filter((f) => taken.has(f.name)).map((f) => f.name);
  const rows = fields
    .filter((f) => !taken.has(f.name))
    .map((f) => ({
      version_id: t.version.id,
      document_id: t.doc.id,
      tenant_id: ctx.tenantId,
      name: f.name,
      value: f.value as Json,
      confidence: f.confidence,
      band: f.band,
      source: {
        system: ctx.clientId,
        systemName: cleanLabel(ctx.name, 80),
        ...(f.source ? { label: f.source } : {}),
      },
      status: "pending" as const,
    }));
  if (!rows.length) return { inserted: [], skipped };
  const saved = must(
    await ctx.admin.from("extraction_fields").insert(rows).select("id"),
    "saving proposed details",
  );
  return { inserted: (saved ?? []).map((r) => r.id), skipped };
}

/**
 * Takes back proposals of an answer that did not apply (the document moved meanwhile). When even
 * that fails the log says so, with ids only, never a value: those rows must be rejected by hand.
 */
export async function takeBackFields(ctx: SystemCtx, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await ctx.admin
    .from("extraction_fields")
    .delete()
    .in("id", [...ids])
    .eq("tenant_id", ctx.tenantId);
  if (error)
    console.error(
      `takeBackFields: ${new DatabaseError("taking back proposed details").message}; ` +
        `tenant ${ctx.tenantId}, rows ${ids.join(",")} stay pending for an answer that did not apply`,
    );
}
