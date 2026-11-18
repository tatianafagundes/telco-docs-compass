// Status moves, legal hold and delete of the TMF gateway, with the shared status path
// (`applyTransition`) that PATCH also uses.
import { z } from "zod";
import type { DocStatus } from "@/schemas/document";
import {
  isTransitionAllowed,
  systemMayApprove,
  pendingRequiredDetails,
  type SpecCharacteristic,
} from "@/services/document-rules";
import { deleteIfAllowed, gatewayRefusal } from "@/services/document-delete";
import { readRequestText } from "@/services/gateway-body";
import { holdColumns, updateDocumentIf } from "@/services/document-update";
import { scopeForTransition, tmfError, TMF_BASE_PATH, type DocRow } from "@/services/tmf667-mapper";
import { errorReply } from "@/services/gateway-reply";
import {
  MAX_BODY_CHARS,
  SystemCtx,
  authenticate,
  bodyTooLarge,
  findDoc,
  loadTmfDocs,
  notFound,
  readJson,
} from "@/services/gateway-core";
import { audit, idempotent } from "@/services/gateway-idempotency";
const refusedMove = (from: string, to: string) => ({
  status: 409,
  body: tmfError(
    409,
    "transitionNotAllowed",
    "Conflict",
    `A ${from} document can't move to ${to}.`,
  ),
});
/** Same status path, scope and approval gate as /transition. */
export async function applyTransition(
  ctx: SystemCtx,
  doc: DocRow,
  target: DocStatus,
): Promise<{ status: number; body: unknown } | null> {
  if (!isTransitionAllowed(doc.status, target)) return refusedMove(doc.status, target);
  if (target === "approved") {
    if (!systemMayApprove(doc.registered_by_client, ctx.clientId)) {
      return {
        status: 409,
        body: tmfError(
          409,
          "fourEyesRequired",
          "Conflict",
          "The system that added this document can't approve it. Another system or a person in the app can.",
        ),
      };
    }
    const { data: specs } = await ctx.admin.rpc("effective_specifications", {
      p_tenant: ctx.tenantId,
    });
    const def = (specs ?? []).find((s) => s.code === doc.document_type)?.definition as
      { specCharacteristic?: SpecCharacteristic[] } | undefined;
    const { data: fields } = await ctx.admin
      .from("extraction_fields")
      .select("name, status")
      .eq("document_id", doc.id)
      .eq("version_id", doc.current_version_id ?? "");
    const pending = pendingRequiredDetails(def?.specCharacteristic ?? [], fields ?? []);
    if (pending.length > 0)
      return {
        status: 409,
        body: tmfError(
          409,
          "requiredDetailsPending",
          "Conflict",
          `${pending.length} required detail(s) still need a person to confirm them.`,
        ),
      };
  }
  const moved = await updateDocumentIf(
    ctx.admin,
    { id: doc.id, tenantId: ctx.tenantId, expect: { status: doc.status } },
    { status: target, updated_at: new Date().toISOString() },
    "changing the status of a document",
  );
  // Someone else moved it first: report it as the refused move it now is.
  if (!moved) return refusedMove(doc.status, target);
  await audit(ctx, "statusChange", doc.id, `${doc.status} to ${target}`);
  return null;
}

export async function deleteDocument(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "delete");
  if (ctx instanceof Response) return ctx;
  return idempotent(request, ctx, `delete:${id}`, { id }, async () => {
    const doc = await findDoc(ctx, id);
    if (!doc)
      return {
        status: 404,
        body: tmfError(404, "notFound", "Not Found", "No document with this id."),
      };
    const refusal = await deleteIfAllowed(ctx.admin, ctx.tenantId, doc);
    if (refusal) return gatewayRefusal(refusal);
    await audit(ctx, "delete", doc.id, "Deleted");
    return { status: 204, body: null };
  });
}

const STATUS_VALUES = [
  "in_review",
  "approved",
  "effective",
  "superseded",
  "expired",
  "archived",
] as const;
const transitionSchema = z.object({ lifecycleState: z.enum(STATUS_VALUES) });

/** Extension (not TMF667): explicit status task. Standard clients can PATCH status instead. */
export async function transitionDocument(request: Request, id: string): Promise<Response> {
  const pre = await readRequestText(request, MAX_BODY_CHARS);
  const parsedPeek = pre.value;
  let to: DocStatus | null = null;
  try {
    to = transitionSchema.parse(JSON.parse(parsedPeek)).lifecycleState;
  } catch {
    to = null;
  }
  const ctx = await authenticate(request, to ? scopeForTransition(to) : "transition");
  if (ctx instanceof Response) return ctx;
  if (pre.tooLarge) return bodyTooLarge(ctx);
  if (!to)
    return errorReply(
      tmfError(
        400,
        "invalidBody",
        "Bad Request",
        `Send {"lifecycleState": one of ${STATUS_VALUES.join(", ")}}.`,
      ),
      ctx.requestId,
    );
  const target = to;
  return idempotent(request, ctx, `transition:${id}`, { to: target }, async () => {
    const doc = await findDoc(ctx, id);
    if (!doc)
      return {
        status: 404,
        body: tmfError(404, "notFound", "Not Found", "No document with this id."),
      };
    const fail = await applyTransition(ctx, doc, target);
    if (fail) return fail;
    const fresh = await findDoc(ctx, doc.id);
    const [tmf] = fresh ? await loadTmfDocs(ctx, [fresh]) : [];
    return { status: 200, body: tmf };
  });
}

const holdSchema = z.object({
  active: z.boolean(),
  reason: z.string().trim().min(1).max(500),
  reference: z.string().max(100).optional(),
});

export async function setLegalHold(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "hold");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx);
  if (!parsed.ok) return parsed.res;
  const input = holdSchema.safeParse(parsed.body);
  if (!input.success)
    return errorReply(
      tmfError(400, "invalidBody", "Bad Request", "Send active (true/false) and a reason."),
      ctx.requestId,
    );
  const h = input.data;
  return idempotent(request, ctx, `hold:${id}`, h, async () => {
    const doc = await findDoc(ctx, id);
    if (!doc)
      return {
        status: 404,
        body: tmfError(404, "notFound", "Not Found", "No document with this id."),
      };
    const now = new Date().toISOString();
    await updateDocumentIf(
      ctx.admin,
      { id: doc.id, tenantId: ctx.tenantId, expect: {} },
      holdColumns(h, null, now),
      "changing the legal hold of a document",
    );
    const ref = h.reference ? ` (${h.reference})` : "";
    await audit(
      ctx,
      "hold",
      doc.id,
      h.active ? `Hold placed${ref}: ${h.reason}` : `Hold released: ${h.reason}`,
    );
    return {
      status: 200,
      body: {
        id: doc.id,
        href: `${ctx.origin}${TMF_BASE_PATH}/document/${doc.id}`,
        legalHold: h.active,
      },
    };
  });
}
