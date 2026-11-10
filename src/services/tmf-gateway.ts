// TMF667 gateway for connected systems (Order care, Ticket management, CRM, CPQ).
// Routes under /api/public/tmf-api/* skip site auth, so every handler starts with authenticate().
// The admin client is loaded only after the system key is verified, and every query is pinned
// to the key's tenant. Business rules are the same pure rules the screens use.
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import { hashBody, idempotencyOutcome, isFrozen, isTransitionAllowed, pendingRequiredDetails, type SpecCharacteristic } from "@/services/document-rules";
import type { Db } from "@/services/seam-runtime";
import {
  hasScope,
  isSafeCallback,
  parseListQuery,
  readBearer,
  scopeForTransition,
  selectFields,
  sha256Hex,
  tmfError,
  toTmfDocument,
  toTmfSpecification,
  TMF_BASE_PATH,
  type DocRow,
  type RelationRow,
  type Scope,
  type TmfError,
  type VersionRow,
} from "@/services/tmf667-mapper";

export const MAX_BODY_CHARS = 50_000;

export interface SystemCtx {
  admin: Db;
  clientId: string;
  name: string;
  tenantId: string;
  scopes: string[];
  origin: string;
  requestId: string;
}

function reply(status: number, body: unknown, requestId: string, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json;charset=utf-8", "X-Request-ID": requestId, "Cache-Control": "no-store", ...extra },
  });
}

export function errorReply(e: TmfError, requestId: string): Response {
  return reply(Number(e.status), e, requestId);
}

const DOC_COLS =
  "id, name, description, document_type, status, sensitivity, legal_hold, effective_date, expiry_date, created_at, updated_at, current_version_id, characteristic";

/** Verifies the system key and returns a tenant-pinned context, or an error response. */
export async function authenticate(request: Request, needed: Scope): Promise<SystemCtx | Response> {
  const requestId = crypto.randomUUID();
  const key = readBearer(request.headers.get("authorization"));
  if (!key) return errorReply(tmfError(401, "unauthorized", "Unauthorized", "Send a system key as 'Authorization: Bearer erad_…'."), requestId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as Db;
  const { data: client } = await admin
    .from("integration_clients")
    .select("id, name, tenant_id, scopes, revoked_at")
    .eq("key_hash", await sha256Hex(key))
    .maybeSingle();
  if (!client || client.revoked_at) return errorReply(tmfError(401, "unauthorized", "Unauthorized", "This system key is not valid."), requestId);
  if (!hasScope(client.scopes, needed)) {
    return errorReply(tmfError(403, "scopeMissing", "Forbidden", `This system key does not include '${needed}'.`), requestId);
  }
  await admin.from("integration_clients").update({ last_used_at: new Date().toISOString() }).eq("id", client.id);
  console.info(JSON.stringify({ op: "tmf", client: client.id, tenant: client.tenant_id, scope: needed, requestId }));
  return { admin, clientId: client.id, name: client.name, tenantId: client.tenant_id, scopes: client.scopes, origin: new URL(request.url).origin, requestId };
}

async function readJson(request: Request, ctx: SystemCtx): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return { ok: false, res: errorReply(tmfError(400, "bodyTooLarge", "Bad Request", "Request body is too large."), ctx.requestId) };
  try {
    return { ok: true, body: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, res: errorReply(tmfError(400, "invalidJson", "Bad Request", "Request body is not valid JSON."), ctx.requestId) };
  }
}

async function audit(ctx: SystemCtx, action: string, documentId: string, detail: string) {
  await ctx.admin.from("document_events").insert({
    tenant_id: ctx.tenantId,
    document_id: documentId,
    actor: null,
    action,
    detail: `${detail} · via ${ctx.name}`.slice(0, 160),
  });
}

/** Writes need an Idempotency-Key header; a replay with the same body returns the stored reply. */
async function idempotent(request: Request, ctx: SystemCtx, operation: string, body: unknown, run: () => Promise<{ status: number; body: unknown }>): Promise<Response> {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    return errorReply(tmfError(400, "idempotencyKeyMissing", "Bad Request", "Send an Idempotency-Key header (8–128 letters, digits, - or _)."), ctx.requestId);
  }
  const requestHash = await hashBody(body);
  const op = `tmf.${operation}`;
  const { data: stored } = await ctx.admin
    .from("idempotency_keys")
    .select("request_hash, response")
    .eq("tenant_id", ctx.tenantId)
    .eq("actor", ctx.clientId)
    .eq("key", key)
    .eq("operation", op)
    .maybeSingle();
  const outcome = idempotencyOutcome(stored, requestHash);
  if (outcome.kind === "conflict") return errorReply(tmfError(409, "idempotencyMismatch", "Conflict", "This Idempotency-Key was used with a different body."), ctx.requestId);
  if (outcome.kind === "replay") {
    const r = outcome.response as { status: number; body: unknown };
    return reply(r.status, r.body, ctx.requestId, { "Idempotent-Replay": "true" });
  }
  const res = await run();
  if (res.status < 300) {
    await ctx.admin.from("idempotency_keys").insert({ tenant_id: ctx.tenantId, actor: ctx.clientId, key, operation: op, request_hash: requestHash, response: res as unknown as Json });
  }
  return reply(res.status, res.body, ctx.requestId);
}

async function loadTmfDocs(ctx: SystemCtx, docs: DocRow[]) {
  const ids = docs.map((d) => d.id);
  if (ids.length === 0) return [];
  const [{ data: versions }, { data: rels }] = await Promise.all([
    ctx.admin.from("document_versions").select("id, document_id, label, mime_type, size_bytes, content_hash, created_at").in("document_id", ids).eq("tenant_id", ctx.tenantId).order("created_at"),
    ctx.admin.from("document_relations").select("document_id, entity_id, role, business_entities!inner(referred_type, tenant_id)").in("document_id", ids).eq("business_entities.tenant_id", ctx.tenantId),
  ]);
  return docs.map((d) =>
    toTmfDocument(
      ctx.origin,
      d,
      (versions ?? []).filter((v) => v.document_id === d.id) as VersionRow[],
      (rels ?? [])
        .filter((r) => r.document_id === d.id)
        .map((r): RelationRow => ({ entity_id: r.entity_id, role: r.role, referred_type: (r.business_entities as { referred_type: string }).referred_type })),
    ),
  );
}

async function findDoc(ctx: SystemCtx, id: string): Promise<DocRow | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data } = await ctx.admin.from("documents").select(DOC_COLS).eq("id", id).eq("tenant_id", ctx.tenantId).is("deleted_at", null).is("purged_at", null).maybeSingle();
  return (data as DocRow | null) ?? null;
}

const notFound = (ctx: SystemCtx) => errorReply(tmfError(404, "notFound", "Not Found", "No document with this id."), ctx.requestId);

// ---------- reads ----------

export async function listDocuments(request: Request): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const parsed = parseListQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return errorReply(parsed.error, ctx.requestId);
  const q = parsed.value;

  let docIds: string[] | null = null;
  if (q.relatedEntityId || q.referredType) {
    let rq = ctx.admin.from("document_relations").select("document_id, business_entities!inner(id, referred_type, tenant_id)").eq("business_entities.tenant_id", ctx.tenantId);
    if (q.relatedEntityId) rq = rq.eq("entity_id", q.relatedEntityId);
    if (q.referredType) rq = rq.eq("business_entities.referred_type", q.referredType);
    const { data } = await rq.limit(1000);
    docIds = [...new Set((data ?? []).map((r) => r.document_id))];
    if (docIds.length === 0) return reply(200, [], ctx.requestId, { "X-Total-Count": "0", "X-Result-Count": "0" });
  }
  let dq = ctx.admin.from("documents").select(DOC_COLS, { count: "exact" }).eq("tenant_id", ctx.tenantId).is("deleted_at", null).is("purged_at", null);
  if (docIds) dq = dq.in("id", docIds);
  if (q.documentType) dq = dq.eq("document_type", q.documentType);
  if (q.lifecycleState) dq = dq.in("status", q.lifecycleState);
  const { data, count } = await dq.order("updated_at", { ascending: false }).range(q.offset, q.offset + q.limit - 1);
  const docs = await loadTmfDocs(ctx, (data ?? []) as DocRow[]);
  const body = docs.map((d) => selectFields(d as unknown as Record<string, unknown>, q.fields));
  return reply(200, body, ctx.requestId, { "X-Total-Count": String(count ?? body.length), "X-Result-Count": String(body.length) });
}

export async function getDocument(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const doc = await findDoc(ctx, id);
  if (!doc) return notFound(ctx);
  const [tmf] = await loadTmfDocs(ctx, [doc]);
  const fields = new URL(request.url).searchParams.get("fields");
  await audit(ctx, "view", doc.id, "Read");
  return reply(200, selectFields(tmf as unknown as Record<string, unknown>, fields ? fields.split(",") : null), ctx.requestId);
}

/** Short-lived download link for one attachment (version). */
export async function getAttachmentContent(request: Request, id: string, attachmentId: string): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const doc = await findDoc(ctx, id);
  if (!doc) return notFound(ctx);
  const { data: v } = await ctx.admin.from("document_versions").select("id, storage_path").eq("id", attachmentId).eq("document_id", doc.id).maybeSingle();
  if (!v?.storage_path) return errorReply(tmfError(404, "notFound", "Not Found", "This attachment has no stored content."), ctx.requestId);
  const { data: pipe } = await ctx.admin.from("documents").select("pipeline_state").eq("id", doc.id).single();
  if (pipe && (pipe.pipeline_state === "scanning" || pipe.pipeline_state === "quarantined")) {
    return errorReply(tmfError(409, "contentLocked", "Conflict", "Content is being checked and can't be downloaded yet."), ctx.requestId);
  }
  const { data: signed } = await ctx.admin.storage.from("documents").createSignedUrl(v.storage_path, 60);
  if (!signed) return errorReply(tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."), ctx.requestId);
  await audit(ctx, "download", doc.id, "Download link");
  return reply(200, { url: signed.signedUrl, expiresInSeconds: 60 }, ctx.requestId);
}

export async function listSpecifications(request: Request): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const { data } = await ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId });
  return reply(200, (data ?? []).map((s) => toTmfSpecification(ctx.origin, s)), ctx.requestId);
}

export async function getSpecification(request: Request, code: string): Promise<Response> {
  const ctx = await authenticate(request, "read");
  if (ctx instanceof Response) return ctx;
  const { data } = await ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId });
  const s = (data ?? []).find((x) => x.code === code);
  if (!s) return errorReply(tmfError(404, "notFound", "Not Found", "No document specification with this id."), ctx.requestId);
  return reply(200, toTmfSpecification(ctx.origin, s), ctx.requestId);
}

// ---------- writes ----------

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).optional(),
  documentType: z.string().min(1).max(64),
  relatedEntity: z.array(z.object({ id: z.string().min(1).max(64), role: z.string().min(1).max(64), "@referredType": z.string().max(64).optional() })).min(1).max(5),
  attachment: z.object({ mimeType: z.string().min(3).max(150), size: z.number().int().nonnegative().optional(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }),
});

export async function createDocument(request: Request): Promise<Response> {
  const ctx = await authenticate(request, "register");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx);
  if (!parsed.ok) return parsed.res;
  const input = createSchema.safeParse(parsed.body);
  if (!input.success) return errorReply(tmfError(400, "invalidBody", "Bad Request", "Check name, documentType, relatedEntity and attachment (mimeType, contentHash)."), ctx.requestId);
  const d = input.data;
  return idempotent(request, ctx, "createDocument", d, async () => {
    const { data: entities } = await ctx.admin.from("business_entities").select("id").in("id", d.relatedEntity.map((r) => r.id)).eq("tenant_id", ctx.tenantId);
    if ((entities ?? []).length !== new Set(d.relatedEntity.map((r) => r.id)).size) {
      return { status: 404, body: tmfError(404, "relatedEntityNotFound", "Not Found", "One or more related entities don't exist for this organisation.") };
    }
    const { data: specs } = await ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId });
    const spec = (specs ?? []).find((s) => s.code === d.documentType);
    if (!spec) return { status: 400, body: tmfError(400, "unknownDocumentType", "Bad Request", "This documentType isn't set up for this organisation.") };
    const def = spec.definition as { acceptedMimeTypes?: string[]; maxSizeMb?: number; defaultSensitivity?: string; retentionPolicyRef?: string };
    if (def.acceptedMimeTypes && !def.acceptedMimeTypes.includes(d.attachment.mimeType)) return { status: 400, body: tmfError(400, "mimeNotAccepted", "Bad Request", "This file type isn't accepted for this documentType.") };
    if (def.maxSizeMb && d.attachment.size && d.attachment.size > def.maxSizeMb * 1024 * 1024) return { status: 400, body: tmfError(400, "tooLarge", "Bad Request", "This file is larger than allowed.") };

    const { data: doc, error } = await ctx.admin
      .from("documents")
      .insert({
        tenant_id: ctx.tenantId,
        name: d.name,
        description: d.description ?? null,
        document_type: d.documentType,
        status: "draft",
        pipeline_state: "uploading",
        sensitivity: (def.defaultSensitivity ?? "internal") as "public" | "internal" | "confidential" | "restricted",
        retention_policy_id: def.retentionPolicyRef ?? null,
        origin: "api",
      })
      .select("id")
      .single();
    if (error || !doc) return { status: 503, body: tmfError(503, "unavailable", "Service Unavailable", "Try again shortly.") };
    const versionId = crypto.randomUUID();
    const storagePath = `${ctx.tenantId}/${versionId}`;
    await ctx.admin.from("document_versions").insert({ id: versionId, document_id: doc.id, tenant_id: ctx.tenantId, label: "1", mime_type: d.attachment.mimeType, size_bytes: d.attachment.size ?? null, content_hash: d.attachment.contentHash, storage_path: storagePath });
    await ctx.admin.from("documents").update({ current_version_id: versionId }).eq("id", doc.id);
    await ctx.admin.from("document_relations").insert(d.relatedEntity.map((r) => ({ document_id: doc.id, entity_id: r.id, role: r.role })));
    const { data: signed } = await ctx.admin.storage.from("documents").createSignedUploadUrl(storagePath);
    await audit(ctx, "upload", doc.id, "Version 1");
    const created = await findDoc(ctx, doc.id);
    const [tmf] = created ? await loadTmfDocs(ctx, [created]) : [];
    return { status: 201, body: { ...tmf, uploadUrl: signed?.signedUrl ?? null } };
  });
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    validFor: z.object({ endDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}/) }).optional(),
  })
  .strict();

export async function patchDocument(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "register");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx);
  if (!parsed.ok) return parsed.res;
  const input = patchSchema.safeParse(parsed.body);
  if (!input.success) return errorReply(tmfError(400, "invalidBody", "Bad Request", "Only name, description and validFor.endDateTime can be changed here."), ctx.requestId);
  return idempotent(request, ctx, `patch:${id}`, input.data, async () => {
    const doc = await findDoc(ctx, id);
    if (!doc) return { status: 404, body: tmfError(404, "notFound", "Not Found", "No document with this id.") };
    if (isFrozen(doc.status)) return { status: 409, body: tmfError(409, "frozen", "Conflict", "This document can no longer be changed.") };
    const p = input.data;
    await ctx.admin
      .from("documents")
      .update({
        ...(p.name ? { name: p.name } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.validFor ? { expiry_date: p.validFor.endDateTime.slice(0, 10) } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", doc.id)
      .eq("tenant_id", ctx.tenantId);
    await audit(ctx, "metadataChange", doc.id, `Changed ${Object.keys(p).join(", ")}`);
    const fresh = await findDoc(ctx, doc.id);
    const [tmf] = fresh ? await loadTmfDocs(ctx, [fresh]) : [];
    return { status: 200, body: tmf };
  });
}

const STATUS_VALUES = ["in_review", "approved", "effective", "superseded", "expired", "archived"] as const;
const transitionSchema = z.object({ lifecycleState: z.enum(STATUS_VALUES) });

export async function transitionDocument(request: Request, id: string): Promise<Response> {
  const parsedPeek = await request.clone().text();
  let to: DocStatus | null = null;
  try {
    to = transitionSchema.parse(JSON.parse(parsedPeek)).lifecycleState;
  } catch {
    to = null;
  }
  const ctx = await authenticate(request, to ? scopeForTransition(to) : "transition");
  if (ctx instanceof Response) return ctx;
  if (!to) return errorReply(tmfError(400, "invalidBody", "Bad Request", `Send {"lifecycleState": one of ${STATUS_VALUES.join(", ")}}.`), ctx.requestId);
  const target = to;
  return idempotent(request, ctx, `transition:${id}`, { to: target }, async () => {
    const doc = await findDoc(ctx, id);
    if (!doc) return { status: 404, body: tmfError(404, "notFound", "Not Found", "No document with this id.") };
    if (!isTransitionAllowed(doc.status, target)) return { status: 409, body: tmfError(409, "transitionNotAllowed", "Conflict", `A ${doc.status} document can't move to ${target}.`) };
    if (target === "approved") {
      const { data: specs } = await ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId });
      const def = (specs ?? []).find((s) => s.code === doc.document_type)?.definition as { specCharacteristic?: SpecCharacteristic[] } | undefined;
      const { data: fields } = await ctx.admin.from("extraction_fields").select("name, status").eq("document_id", doc.id).eq("version_id", doc.current_version_id ?? "");
      const pending = pendingRequiredDetails(def?.specCharacteristic ?? [], fields ?? []);
      if (pending.length > 0) return { status: 409, body: tmfError(409, "requiredDetailsPending", "Conflict", `${pending.length} required detail(s) still need a person to confirm them.`) };
    }
    await ctx.admin.from("documents").update({ status: target, updated_at: new Date().toISOString() }).eq("id", doc.id).eq("tenant_id", ctx.tenantId);
    await audit(ctx, "statusChange", doc.id, `${doc.status} to ${target}`);
    const fresh = await findDoc(ctx, doc.id);
    const [tmf] = fresh ? await loadTmfDocs(ctx, [fresh]) : [];
    return { status: 200, body: tmf };
  });
}

const holdSchema = z.object({ active: z.boolean(), reason: z.string().trim().min(1).max(500), reference: z.string().max(100).optional() });

export async function setLegalHold(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "hold");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx);
  if (!parsed.ok) return parsed.res;
  const input = holdSchema.safeParse(parsed.body);
  if (!input.success) return errorReply(tmfError(400, "invalidBody", "Bad Request", "Send active (true/false) and a reason."), ctx.requestId);
  const h = input.data;
  return idempotent(request, ctx, `hold:${id}`, h, async () => {
    const doc = await findDoc(ctx, id);
    if (!doc) return { status: 404, body: tmfError(404, "notFound", "Not Found", "No document with this id.") };
    const now = new Date().toISOString();
    await ctx.admin
      .from("documents")
      .update({ legal_hold: h.active, hold_reason: h.active ? h.reason : null, hold_reference: h.active ? (h.reference ?? null) : null, hold_since: h.active ? now : null, hold_set_by: null, updated_at: now })
      .eq("id", doc.id)
      .eq("tenant_id", ctx.tenantId);
    const ref = h.reference ? ` (${h.reference})` : "";
    await audit(ctx, "hold", doc.id, h.active ? `Hold placed${ref}: ${h.reason}` : `Hold released: ${h.reason}`);
    return { status: 200, body: { id: doc.id, href: `${ctx.origin}${TMF_BASE_PATH}/document/${doc.id}`, legalHold: h.active } };
  });
}

// ---------- events hub (TMF688 pattern) ----------

const hubSchema = z.object({ callback: z.string().url().max(500), query: z.string().max(300).optional() });

export async function subscribe(request: Request): Promise<Response> {
  const ctx = await authenticate(request, "subscribe");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx);
  if (!parsed.ok) return parsed.res;
  const input = hubSchema.safeParse(parsed.body);
  if (!input.success || !isSafeCallback(input.data.callback)) {
    return errorReply(tmfError(400, "invalidCallback", "Bad Request", "callback must be a public https address."), ctx.requestId);
  }
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(secretBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const { data } = await ctx.admin
    .from("event_subscriptions")
    .insert({ client_id: ctx.clientId, tenant_id: ctx.tenantId, callback: input.data.callback, query: input.data.query ?? null, secret })
    .select("id, callback, query")
    .single();
  if (!data) return errorReply(tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."), ctx.requestId);
  // The signing secret is shown once; events carry X-Signature: sha256=<hmac of body>.
  return reply(201, { id: data.id, callback: data.callback, query: data.query, signingSecret: secret }, ctx.requestId);
}

export async function unsubscribe(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "subscribe");
  if (ctx instanceof Response) return ctx;
  if (!z.string().uuid().safeParse(id).success) return notFound(ctx);
  const { data } = await ctx.admin.from("event_subscriptions").delete().eq("id", id).eq("client_id", ctx.clientId).select("id");
  if (!data || data.length === 0) return errorReply(tmfError(404, "notFound", "Not Found", "No subscription with this id."), ctx.requestId);
  return reply(204, null, ctx.requestId);
}
