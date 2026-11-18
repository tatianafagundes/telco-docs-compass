// PATCH /document/{id}: change name, description, dates, characteristics, identifiers, related
// records, and optionally the status (the same status path as /transition).
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import { metadataPatchAllowed, startsWithCalendarDay } from "@/services/document-rules";
import { readRequestText } from "@/services/gateway-body";
import { updateDocumentIf } from "@/services/document-update";
import { characteristicSchema, extIdSchema, relatedSchema } from "@/services/gateway-create-input";
import {
  hasScope,
  scopeForTransition,
  targetForTmfStatus,
  tmfError,
} from "@/services/tmf667-mapper";
import { errorReply } from "@/services/gateway-reply";
import { applyTransition } from "@/services/gateway-changes";
import {
  MAX_BODY_CHARS,
  authenticate,
  findDoc,
  loadTmfDocs,
  notFound,
  readJson,
} from "@/services/gateway-core";
import { audit, idempotent } from "@/services/gateway-idempotency";
/** TMF Document_Update subset we accept. Unknown fields are refused so nothing is silently ignored. */
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    validFor: z.object({ endDateTime: z.string().refine(startsWithCalendarDay) }).optional(),
    status: z.string().max(32).optional(),
    characteristic: z.array(characteristicSchema).max(50).optional(),
    externalIdentifier: z.array(extIdSchema).max(10).optional(),
    relatedEntity: z.array(relatedSchema).max(5).optional(),
    "@type": z.string().max(64).optional(),
  })
  .strict();

const PATCH_TYPES = ["application/merge-patch+json", "application/json"];

export async function patchDocument(request: Request, id: string): Promise<Response> {
  const ctype =
    (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (ctype && !PATCH_TYPES.includes(ctype)) {
    return errorReply(
      tmfError(
        415,
        "unsupportedMediaType",
        "Unsupported Media Type",
        "Send application/merge-patch+json.",
      ),
      crypto.randomUUID(),
    );
  }
  const pre = await readRequestText(request, MAX_BODY_CHARS);
  const peek = pre.value;
  let peekBody: Record<string, unknown> = {};
  try {
    const j: unknown = JSON.parse(peek || "{}");
    if (typeof j === "object" && j !== null) peekBody = j as Record<string, unknown>;
  } catch {
    peekBody = {};
  }
  // A status-only change needs the transition/approve scope; other fields need register.
  const tmfTarget =
    typeof peekBody["status"] === "string" ? targetForTmfStatus(peekBody["status"]) : null;
  const onlyStatus =
    Object.keys(peekBody).filter((k) => k !== "@type").length === 1 && tmfTarget !== null;
  const ctx = await authenticate(
    request,
    onlyStatus && tmfTarget ? scopeForTransition(tmfTarget) : "register",
  );
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx, MAX_BODY_CHARS, pre);
  if (!parsed.ok) return parsed.res;
  const input = patchSchema.safeParse(parsed.body);
  if (!input.success)
    return errorReply(
      tmfError(
        400,
        "invalidBody",
        "Bad Request",
        "You can change name, description, status, characteristic, externalIdentifier, relatedEntity (add) and validFor.endDateTime.",
      ),
      ctx.requestId,
    );
  const p = input.data;
  let target: DocStatus | null = null;
  if (p.status !== undefined) {
    target = targetForTmfStatus(p.status);
    if (!target)
      return errorReply(
        tmfError(
          400,
          "invalidStatus",
          "Bad Request",
          "status can be created, reviewed, approved, published or archived. Use DELETE to delete.",
        ),
        ctx.requestId,
      );
    if (!onlyStatus && !hasScope(ctx.scopes, scopeForTransition(target))) {
      return errorReply(
        tmfError(
          403,
          "scopeMissing",
          "Forbidden",
          `This system key does not include '${scopeForTransition(target)}'.`,
        ),
        ctx.requestId,
      );
    }
  }
  return idempotent(request, ctx, `patch:${id}`, p, async () => {
    const doc = await findDoc(ctx, id);
    if (!doc)
      return {
        status: 404,
        body: tmfError(404, "notFound", "Not Found", "No document with this id."),
      };
    const { status: _s, "@type": _t, ...fields } = p;
    const editsFields = Object.keys(fields).length > 0;
    const check = metadataPatchAllowed(doc.status, Object.keys(fields));
    if (!check.ok && check.reason === "frozen")
      return {
        status: 409,
        body: tmfError(409, "frozen", "Conflict", "This document can no longer be changed."),
      };
    if (!check.ok && check.reason === "approvedContent") {
      return {
        status: 409,
        body: tmfError(
          409,
          "approvedContentLocked",
          "Conflict",
          `This document is approved, so only name, description, externalIdentifier and relatedEntity can change. Not changed: ${check.blocked.join(", ")}.`,
        ),
      };
    }
    if (p.relatedEntity?.length) {
      const ids = p.relatedEntity.map((r) => r.id);
      const { data: ents } = await ctx.admin
        .from("business_entities")
        .select("id")
        .in("id", ids)
        .eq("tenant_id", ctx.tenantId);
      if ((ents ?? []).length !== new Set(ids).size)
        return {
          status: 404,
          body: tmfError(
            404,
            "relatedEntityNotFound",
            "Not Found",
            "One or more related entities don't exist for this organisation.",
          ),
        };
    }
    if (editsFields) {
      // Merge-patch on arrays replaces them, except relatedEntity which only adds (links are never removed by systems).
      const merged = p.characteristic
        ? [
            ...asCharacteristicRows(doc.characteristic).filter(
              (c) => !p.characteristic?.some((n) => n.name === c.name),
            ),
            ...p.characteristic,
          ]
        : null;
      await updateDocumentIf(
        ctx.admin,
        { id: doc.id, tenantId: ctx.tenantId, expect: {} },
        {
          ...(p.name ? { name: p.name } : {}),
          ...(p.description !== undefined ? { description: p.description } : {}),
          ...(p.validFor ? { expiry_date: p.validFor.endDateTime.slice(0, 10) } : {}),
          ...(merged ? { characteristic: merged as unknown as Json } : {}),
          ...(p.externalIdentifier
            ? { external_identifier: p.externalIdentifier as unknown as Json }
            : {}),
          updated_at: new Date().toISOString(),
        },
        "changing the details of a document",
      );
      if (p.relatedEntity?.length) {
        await ctx.admin.from("document_relations").upsert(
          p.relatedEntity.map((r) => ({ document_id: doc.id, entity_id: r.id, role: r.role })),
          { onConflict: "document_id,entity_id,role", ignoreDuplicates: true },
        );
      }
      // Field names only; values never reach the activity log.
      await audit(ctx, "metadataChange", doc.id, `Changed ${Object.keys(fields).join(", ")}`);
    }
    if (target && target !== doc.status) {
      const fresh = await findDoc(ctx, doc.id);
      const fail = fresh ? await applyTransition(ctx, fresh, target) : null;
      if (fail) return fail;
    }
    const fresh = await findDoc(ctx, doc.id);
    const [tmf] = fresh ? await loadTmfDocs(ctx, [fresh]) : [];
    return { status: 200, body: tmf };
  });
}

function asCharacteristicRows(v: unknown): { name: string; value: unknown; valueType?: string }[] {
  return Array.isArray(v)
    ? v.filter(
        (c): c is { name: string; value: unknown } =>
          typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string",
      )
    : [];
}

/** Standard DELETE: same rules as delete in the app (holds and keep-until dates block it). Soft delete; restorable by an admin. */
