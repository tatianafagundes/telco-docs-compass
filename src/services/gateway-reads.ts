// Read operations of the TMF gateway: list and get documents, the download link of an attachment,
// and the document specifications.
//
// Does not change anything except the activity record of a download.
import type { DocStatus } from "@/schemas/document";
import {
  parseListQuery,
  selectFields,
  tmfError,
  toTmfSpecification,
  type DocRow,
} from "@/services/tmf667-mapper";
import { externalIdentifierFilter, relatedDocumentIds } from "@/services/gateway-list-filter";
import { errorReply, reply } from "@/services/gateway-reply";
import { DOC_COLS, authenticate, findDoc, loadTmfDocs, notFound } from "@/services/gateway-core";
import { audit } from "@/services/gateway-idempotency";
// ---------- reads ----------

export async function listDocuments(request: Request): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const parsed = parseListQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return errorReply(parsed.error, ctx.requestId);
  const q = parsed.value;

  const related = await relatedDocumentIds(ctx.admin, ctx.tenantId, q);
  if (related && !Array.isArray(related)) return errorReply(related.error, ctx.requestId);
  const docIds = related;
  if (docIds?.length === 0)
    return reply(200, [], ctx.requestId, { "X-Total-Count": "0", "X-Result-Count": "0" });
  let dq = ctx.admin
    .from("documents")
    .select(DOC_COLS, { count: "exact" })
    .eq("tenant_id", ctx.tenantId)
    .is("deleted_at", null)
    .is("purged_at", null);
  if (docIds) dq = dq.in("id", docIds);
  if (q.documentType) dq = dq.eq("document_type", q.documentType);
  if (q.lifecycleState)
    dq = dq.in("status", q.lifecycleState.length ? q.lifecycleState : ["__none__" as DocStatus]);
  if (q.externalId)
    dq = dq.filter("external_identifier", "cs", externalIdentifierFilter(request, q.externalId));
  const { data, count } = await dq
    .order("updated_at", { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);
  const docs = await loadTmfDocs(ctx, (data ?? []) as DocRow[]);
  const body = docs.map((d) => selectFields(d as unknown as Record<string, unknown>, q.fields));
  return reply(200, body, ctx.requestId, {
    "X-Total-Count": String(count ?? body.length),
    "X-Result-Count": String(body.length),
  });
}

export async function getDocument(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const doc = await findDoc(ctx, id);
  if (!doc) return notFound(ctx);
  const [tmf] = await loadTmfDocs(ctx, [doc]);
  const fields = new URL(request.url).searchParams.get("fields");
  await audit(ctx, "view", doc.id, "Read");
  return reply(
    200,
    selectFields(tmf as unknown as Record<string, unknown>, fields ? fields.split(",") : null),
    ctx.requestId,
  );
}

/** Short-lived download link for one attachment (version). */
export async function getAttachmentContent(
  request: Request,
  id: string,
  attachmentId: string,
): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const doc = await findDoc(ctx, id);
  if (!doc) return notFound(ctx);
  const { data: v } = await ctx.admin
    .from("document_versions")
    .select("id, storage_path")
    .eq("id", attachmentId)
    .eq("document_id", doc.id)
    .maybeSingle();
  if (!v?.storage_path)
    return errorReply(
      tmfError(404, "notFound", "Not Found", "This attachment has no stored content."),
      ctx.requestId,
    );
  const { data: pipe } = await ctx.admin
    .from("documents")
    .select("pipeline_state")
    .eq("id", doc.id)
    .single();
  if (pipe && (pipe.pipeline_state === "scanning" || pipe.pipeline_state === "quarantined")) {
    return errorReply(
      tmfError(
        409,
        "contentLocked",
        "Conflict",
        "Content is being checked and can't be downloaded yet.",
      ),
      ctx.requestId,
    );
  }
  const { data: signed } = await ctx.admin.storage
    .from("documents")
    .createSignedUrl(v.storage_path, 60);
  if (!signed)
    return errorReply(
      tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."),
      ctx.requestId,
    );
  await audit(ctx, "download", doc.id, "Download link");
  return reply(200, { url: signed.signedUrl, expiresInSeconds: 60 }, ctx.requestId);
}

export async function listSpecifications(request: Request): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const { data } = await ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId });
  return reply(
    200,
    (data ?? []).map((s) => toTmfSpecification(ctx.origin, s)),
    ctx.requestId,
  );
}

export async function getSpecification(request: Request, code: string): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const { data } = await ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId });
  const s = (data ?? []).find((x) => x.code === code);
  if (!s)
    return errorReply(
      tmfError(404, "notFound", "Not Found", "No document specification with this id."),
      ctx.requestId,
    );
  return reply(200, toTmfSpecification(ctx.origin, s), ctx.requestId);
}
