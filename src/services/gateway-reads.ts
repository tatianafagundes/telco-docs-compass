// Read operations of the TMF gateway: list and get documents, the download link of an attachment,
// and the document specifications.
//
// Does not change anything except the activity record of a download.
import { DOWNLOAD_URL_SECONDS } from "@/services/document-rules";
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
import { isUuid, readDetail } from "@/services/file-hook-detail";
import { downloadDecision, type Downloader } from "@/services/file-hook-download";
import { recordScanDownload } from "@/services/file-result-receipts";
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

/**
 * Short-lived download link for one attachment (version). A `read` key gets a checked file; the
 * organisation's own antivirus (`scan`) or reader (`extract`) gets the current version during its own
 * step, and the antivirus's download is recorded so a `clean` answer can be checked against it.
 * A quarantined version is never downloaded (file-hooks spec R2.1, R3.1, D5).
 */
export async function getAttachmentContent(
  request: Request,
  id: string,
  attachmentId: string,
): Promise<Response> {
  const ctx = await authenticate(request, ["read", "scan", "extract"]);
  if (ctx instanceof Response) return ctx;
  const doc = await findDoc(ctx, id);
  if (!doc || !isUuid(attachmentId)) return notFound(ctx);
  const [{ data: v }, { data: pipe }] = await Promise.all([
    ctx.admin
      .from("document_versions")
      .select("id, storage_path")
      .eq("id", attachmentId)
      .eq("document_id", doc.id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle(),
    ctx.admin
      .from("documents")
      .select("pipeline_state, pipeline_detail, current_version_id")
      .eq("id", doc.id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle(),
  ]);
  if (!v?.storage_path || !pipe)
    return errorReply(
      tmfError(404, "notFound", "Not Found", "This attachment has no stored content."),
      ctx.requestId,
    );
  const who: Downloader = ctx.scopes.includes("scan")
    ? { kind: "scanner", clientId: ctx.clientId }
    : ctx.scopes.includes("extract")
      ? { kind: "reader", clientId: ctx.clientId }
      : { kind: "readKey" };
  const decision = downloadDecision(
    who,
    {
      pipelineState: pipe.pipeline_state,
      pipelineDetail: pipe.pipeline_detail,
      currentVersionId: pipe.current_version_id,
    },
    v.id,
  );
  if (!decision.ok)
    return errorReply(
      decision.code === "quarantined"
        ? tmfError(
            409,
            "quarantined",
            "Conflict",
            "This file is blocked: a threat was found in it.",
          )
        : decision.code === "notYourStep"
          ? tmfError(409, "notYourStep", "Conflict", "This file is not waiting for this system.")
          : tmfError(
              409,
              "contentLocked",
              "Conflict",
              "Content is being checked and can't be downloaded yet.",
            ),
      ctx.requestId,
    );
  const { data: signed } = await ctx.admin.storage
    .from("documents")
    .createSignedUrl(v.storage_path, DOWNLOAD_URL_SECONDS);
  if (!signed)
    return errorReply(
      tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."),
      ctx.requestId,
    );
  if (decision.receipt)
    await recordScanDownload(ctx, doc.id, v.id, readDetail(pipe.pipeline_detail).attempt);
  else await audit(ctx, "download", doc.id, "Download link");
  return reply(
    200,
    { url: signed.signedUrl, expiresInSeconds: DOWNLOAD_URL_SECONDS },
    ctx.requestId,
  );
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
