// The answers of the organisation's own antivirus (scanResult) and reader (extractionResult) for a
// file it was given (file-hooks spec R2, R3). Checks, in order: key and scope, designated system
// (authenticate), document and version of the key's organisation (404), current version, the step
// waits for this system and this attempt, the hash, and for `clean` that this system downloaded the
// file in this attempt. Nothing is written when a check refuses.
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { resolveOwners } from "@/services/external-processing";
import {
  checkExtractedFields,
  extractionResultSchema,
  scanResultSchema,
  type FieldSpec,
} from "@/services/file-hook-fields";
import { sameContentHash, stepTransition, type StepOwner } from "@/services/file-hook-rules";
import { cleanLabel } from "@/services/file-hook-text";
import {
  CHANGED,
  loadTarget,
  notCurrent,
  NOT_FOUND,
  refusalAnswer,
  writeOutcome,
  type Answer,
  type Target,
} from "@/services/file-result-target";
import { downloadedForScan } from "@/services/file-result-receipts";
import { authenticate, readJson, type SystemCtx } from "@/services/gateway-core";
import { audit, idempotent } from "@/services/gateway-idempotency";
import { errorReply } from "@/services/gateway-reply";
import { must } from "@/services/shared/must";
import { processAsSystem } from "@/services/system-processing";
import { tmfError } from "@/services/tmf667-mapper";

/** A reader's answer holds up to 100 details of up to 2000 characters each. */
export const MAX_RESULT_BODY_CHARS = 300000;
const SIMULATED: Record<"scan" | "read", StepOwner> = {
  scan: { mode: "simulated" },
  read: { mode: "simulated" },
};
const invalid = (ctx: SystemCtx, issues: z.ZodIssue[]) =>
  errorReply(
    tmfError(
      400,
      "invalidBody",
      "Bad Request",
      // Where the body is wrong, never what it said.
      `Check ${[...new Set(issues.map((i) => i.path.join(".") || "the body"))].slice(0, 10).join(", ")}.`,
    ),
    ctx.requestId,
  );
const outcome = (t: Target, state: string, attempt: number, extra: object = {}): Answer => ({
  status: 200,
  body: { id: t.doc.id, versionId: t.version.id, state, attempt, ...extra },
});
/** The hash the system sent, as the server computed it: lowercase hex, `sha256:` optional. */
const sentHash = (h: string) => h.replace(/^sha256:/i, "").toLowerCase();

export async function postScanResult(
  request: Request,
  id: string,
  versionId: string,
): Promise<Response> {
  const ctx = await authenticate(request, "scan");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx);
  if (!parsed.ok) return parsed.res;
  const b = scanResultSchema.safeParse(parsed.body);
  if (!b.success) return invalid(ctx, b.error.issues);
  const body = b.data;
  return idempotent(
    request,
    ctx,
    `scanResult:${id}:${versionId}:${body.attempt}`,
    body,
    async () => {
      const t = await loadTarget(ctx, id, versionId);
      if (!t) return NOT_FOUND;
      const old = notCurrent(t);
      if (old) return old;
      const next = stepTransition(
        t.doc.pipeline_state,
        t.doc.pipeline_detail,
        {
          kind: "scanResult",
          result: body.result,
          from: { clientId: ctx.clientId, versionId: t.version.id, attempt: body.attempt },
        },
        {
          now: new Date().toISOString(),
          versionId: t.version.id,
          owner:
            body.result === "clean"
              ? await resolveOwners(ctx.admin, ctx.tenantId, new Date())
              : SIMULATED,
        },
      );
      if (!next.ok)
        return next.code === "replay"
          ? outcome(t, t.doc.pipeline_state, body.attempt, { replayed: true })
          : refusalAnswer(next.code, "scan");
      if (!sameContentHash(t.version.content_hash, sentHash(body.contentHash)))
        return {
          status: 409,
          body: tmfError(
            409,
            "hashMismatch",
            "Conflict",
            "contentHash is not the hash of the stored file.",
          ),
        };
      if (
        body.result === "clean" &&
        !(await downloadedForScan(ctx, t.doc.id, t.version.id, body.attempt))
      )
        return {
          status: 409,
          body: tmfError(
            409,
            "notFetched",
            "Conflict",
            "Download the file in this attempt before answering clean.",
          ),
        };
      if (!(await writeOutcome(ctx, t.doc.id, next))) return CHANGED;
      // The threat name appears here only, never in events or logs (R2.7).
      const what =
        body.result === "infected"
          ? `infected: ${body.threatName ?? "threat"}`
          : body.result === "clean"
            ? "clean"
            : "could not check";
      await audit(
        ctx,
        "scanResult",
        t.doc.id,
        `Scan ${what} (${body.engine}, attempt ${body.attempt})`,
      );
      let state: string = next.state;
      // The built-in reading is run here: no browser waits on a file the antivirus answered for.
      if (next.state === "reading" && next.detail.mode === "simulated") {
        const r = await processAsSystem(ctx, t.doc.id);
        if (r.ok) state = r.data.state;
      }
      return outcome(t, state, body.attempt);
    },
  );
}

/** The details of a document type a reader may fill, as stored in its specification. */
async function fieldSpecs(ctx: SystemCtx, documentType: string): Promise<FieldSpec[]> {
  const { data } = await ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId });
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

export async function postExtractionResult(
  request: Request,
  id: string,
  versionId: string,
): Promise<Response> {
  const ctx = await authenticate(request, "extract");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx, MAX_RESULT_BODY_CHARS);
  if (!parsed.ok) return parsed.res;
  const b = extractionResultSchema.safeParse(parsed.body);
  if (!b.success) return invalid(ctx, b.error.issues);
  const body = b.data;
  return idempotent(
    request,
    ctx,
    `extractionResult:${id}:${versionId}:${body.attempt}`,
    body,
    async () => {
      const t = await loadTarget(ctx, id, versionId);
      if (!t) return NOT_FOUND;
      const old = notCurrent(t);
      if (old) return old;
      const next = stepTransition(
        t.doc.pipeline_state,
        t.doc.pipeline_detail,
        {
          kind: "readResult",
          result: body.result,
          from: { clientId: ctx.clientId, versionId: t.version.id, attempt: body.attempt },
        },
        { now: new Date().toISOString(), versionId: t.version.id, owner: SIMULATED },
      );
      if (!next.ok)
        return next.code === "replay"
          ? outcome(t, t.doc.pipeline_state, body.attempt, { replayed: true })
          : refusalAnswer(next.code, "read");
      let inserted: string[] = [];
      let skipped: string[] = [];
      if (body.result === "read" && body.fields.length) {
        const check = checkExtractedFields(body.fields, await fieldSpecs(ctx, t.doc.document_type));
        if (!check.ok)
          return {
            status: 400,
            body: {
              ...tmfError(
                400,
                check.code,
                "Bad Request",
                `Check these details: ${check.names.join(", ")}.`,
              ),
              names: check.names,
            },
          };
        // A detail a person already has for this version keeps the person's value (R3.4).
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
        skipped = check.fields.filter((f) => taken.has(f.name)).map((f) => f.name);
        const rows = check.fields
          .filter((f) => !taken.has(f.name))
          .map((f) => ({
            version_id: t.version.id,
            document_id: t.doc.id,
            tenant_id: ctx.tenantId,
            name: f.name,
            value: f.value as Json,
            confidence: f.confidence,
            band: f.band,
            // Proposed by a system: a person checks each one before it counts (R3.4, BR-023).
            source: {
              system: ctx.clientId,
              systemName: cleanLabel(ctx.name, 80),
              ...(f.source ? { label: f.source } : {}),
            },
            status: "pending" as const,
          }));
        if (rows.length)
          inserted = (
            must(
              await ctx.admin.from("extraction_fields").insert(rows).select("id"),
              "saving proposed details",
            ) ?? []
          ).map((r) => r.id);
      }
      if (!(await writeOutcome(ctx, t.doc.id, next))) {
        if (inserted.length)
          await ctx.admin
            .from("extraction_fields")
            .delete()
            .in("id", inserted)
            .eq("tenant_id", ctx.tenantId);
        return CHANGED;
      }
      // Names and counts only, never a value (R6.4).
      await audit(
        ctx,
        "extractionResult",
        t.doc.id,
        body.result === "read"
          ? `Read: ${inserted.length} detail(s) proposed (attempt ${body.attempt})`
          : `Could not read the file (attempt ${body.attempt})`,
      );
      return outcome(
        t,
        next.state,
        body.attempt,
        body.result === "read" ? { proposed: inserted.length, skipped } : {},
      );
    },
  );
}
