// TMF667 gateway for connected systems (Order care, Ticket management, CRM, CPQ).
// Routes under /api/public/tmf-api/* skip site auth, so every handler starts with authenticate().
// The admin client is loaded only after the system key is verified, and every query is pinned
// to the key's tenant. Business rules are the same pure rules the screens use.
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import { hashBody, idempotencyOutcome, isFrozen, isTransitionAllowed, pendingRequiredDetails, type SpecCharacteristic } from "@/services/document-rules";
import { deleteState } from "@/services/document-actions";
import type { Db } from "@/services/seam-runtime";
import {
  asExternalIdentifiers,
  fromStandardReferredType,
  hasScope,
  isPrivateIp,
  isSafeCallback,
  parseListQuery,
  readBearer,
  scopeForTransition,
  selectFields,
  sha256Hex,
  targetForTmfStatus,
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
/** Inline base64 attachments (TMF attachment.content) may be larger than ordinary bodies. */
export const MAX_INLINE_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_BODY_CHARS = Math.ceil((MAX_INLINE_BYTES * 4) / 3) + 20_000;
const MAX_URL_FETCH_BYTES = 25 * 1024 * 1024;
/** Per key, per minute. */
export const RATE_LIMITS = { read: 120, write: 30 } as const;

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
  "id, tenant_id, name, description, document_type, status, sensitivity, legal_hold, effective_date, expiry_date, created_at, updated_at, current_version_id, characteristic, external_identifier, retain_until";

/**
 * Verifies the system key (erad_…) or a short-lived OAuth token (eradt_…), checks expiry, scope and
 * the per-minute rate limit, and returns a tenant-pinned context, or an error response.
 */
export async function authenticate(request: Request, needed: Scope): Promise<SystemCtx | Response> {
  const requestId = crypto.randomUUID();
  const key = readBearer(request.headers.get("authorization"));
  if (!key) return errorReply(tmfError(401, "unauthorized", "Unauthorized", "Send a system key or access token as 'Authorization: Bearer …'."), requestId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as Db;
  let clientId: string | null = null;
  if (key.startsWith("eradt_")) {
    const { data: tok } = await admin.from("integration_tokens").select("client_id, expires_at").eq("token_hash", await sha256Hex(key)).maybeSingle();
    if (tok && new Date(tok.expires_at) > new Date()) clientId = tok.client_id;
  }
  const base = admin.from("integration_clients").select("id, name, tenant_id, scopes, revoked_at, expires_at");
  const { data: client } = clientId ? await base.eq("id", clientId).maybeSingle() : key.startsWith("erad_") ? await base.eq("key_hash", await sha256Hex(key)).maybeSingle() : { data: null };
  const expired = client?.expires_at ? new Date(client.expires_at) <= new Date() : false;
  if (!client || client.revoked_at || expired) {
    return errorReply(tmfError(401, "unauthorized", "Unauthorized", expired ? "This system key has expired. Ask an administrator for a new key." : "This system key is not valid."), requestId);
  }
  if (!hasScope(client.scopes, needed)) {
    return errorReply(tmfError(403, "scopeMissing", "Forbidden", `This system key does not include '${needed}'.`), requestId);
  }
  const kind = request.method === "GET" ? "read" : "write";
  const { data: hits } = await admin.rpc("api_hit", { p_client: client.id, p_kind: kind });
  if (typeof hits === "number" && hits > RATE_LIMITS[kind]) {
    await admin.from("integration_clients").update({ last_rate_limited_at: new Date().toISOString() }).eq("id", client.id);
    const r = errorReply(tmfError(429, "tooManyRequests", "Too Many Requests", `Limit is ${RATE_LIMITS[kind]} ${kind === "read" ? "reads" : "changes"} per minute for this key.`), requestId);
    r.headers.set("Retry-After", String(60 - new Date().getSeconds()));
    return r;
  }
  await admin.from("integration_clients").update({ last_used_at: new Date().toISOString() }).eq("id", client.id);
  console.info(JSON.stringify({ op: "tmf", client: client.id, tenant: client.tenant_id, scope: needed, requestId }));
  return { admin, clientId: client.id, name: client.name, tenantId: client.tenant_id, scopes: client.scopes, origin: new URL(request.url).origin, requestId };
}

async function readJson(request: Request, ctx: SystemCtx, maxChars = MAX_BODY_CHARS): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const text = await request.text();
  if (text.length > maxChars) return { ok: false, res: errorReply(tmfError(400, "bodyTooLarge", "Bad Request", "Request body is too large."), ctx.requestId) };
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
  if (res.status < 300 || res.status === 204) {
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
  if (q.lifecycleState) dq = dq.in("status", q.lifecycleState.length ? q.lifecycleState : ["__none__" as DocStatus]);
  if (q.externalId) dq = dq.contains("external_identifier", [{ id: q.externalId }]);
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

const relatedSchema = z.object({ id: z.string().min(1).max(64), role: z.string().min(1).max(64), "@referredType": z.string().max(64).optional() });
const extIdSchema = z.object({ id: z.string().min(1).max(100), owner: z.string().max(100).optional(), externalIdentifierType: z.string().max(64).optional() });
const characteristicSchema = z.object({ name: z.string().min(1).max(64), value: z.union([z.string().max(500), z.number(), z.boolean()]), valueType: z.string().max(32).optional() });

/** TMF AttachmentRefOrValue: file details only (we return an upload address), a url to fetch, or inline base64 content. */
const attachmentSchema = z.object({
  mimeType: z.string().min(3).max(150),
  name: z.string().max(255).optional(),
  size: z.union([z.number().int().nonnegative(), z.object({ amount: z.number().nonnegative(), units: z.string().max(16).optional() })]).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  url: z.string().url().max(1000).optional(),
  content: z.string().max(MAX_INLINE_BODY_CHARS).optional(),
  attachmentType: z.string().max(64).optional(),
  "@type": z.string().max(64).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).optional(),
  documentType: z.string().min(1).max(64),
  relatedEntity: z.array(relatedSchema).min(1).max(5),
  // Standard: array of attachments (we accept exactly one file per new document). Legacy: a single object.
  attachment: z.union([z.array(attachmentSchema).min(1).max(1), attachmentSchema]),
  externalIdentifier: z.array(extIdSchema).max(10).optional(),
  characteristic: z.array(characteristicSchema).max(50).optional(),
  "@type": z.string().max(64).optional(),
  "@baseType": z.string().max(64).optional(),
});

function sizeBytes(size: z.infer<typeof attachmentSchema>["size"]): number | undefined {
  if (size === undefined) return undefined;
  return typeof size === "number" ? size : Math.round(size.amount);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Resolves the host over DNS-over-HTTPS and refuses names that point at private addresses. */
export async function resolvesPublic(url: string): Promise<boolean> {
  if (!isSafeCallback(url)) return false;
  const host = new URL(url).hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !isPrivateIp(host);
  try {
    const answers: string[] = [];
    for (const type of ["A", "AAAA"]) {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(3000) });
      const j = (await r.json()) as { Answer?: { type: number; data: string }[] };
      for (const a of j.Answer ?? []) if (a.type === 1 || a.type === 28) answers.push(a.data);
    }
    return answers.length > 0 && answers.every((ip) => !isPrivateIp(ip));
  } catch {
    return false;
  }
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  if (!(await resolvesPublic(url))) return null;
  try {
    const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const len = Number(r.headers.get("content-length") ?? "0");
    if (len > MAX_URL_FETCH_BYTES) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    return buf.byteLength > MAX_URL_FETCH_BYTES ? null : buf;
  } catch {
    return null;
  }
}

export async function createDocument(request: Request): Promise<Response> {
  const ctx = await authenticate(request, "register");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx, MAX_INLINE_BODY_CHARS);
  if (!parsed.ok) return parsed.res;
  const input = createSchema.safeParse(parsed.body);
  if (!input.success) return errorReply(tmfError(400, "invalidBody", "Bad Request", "Check name, documentType, relatedEntity and attachment (mimeType plus contentHash, url or content)."), ctx.requestId);
  const d = input.data;
  const att = Array.isArray(d.attachment) ? d.attachment[0] : d.attachment;
  if (!att) return errorReply(tmfError(400, "invalidBody", "Bad Request", "Send one attachment."), ctx.requestId);
  if (!att.contentHash && !att.url && !att.content) return errorReply(tmfError(400, "invalidBody", "Bad Request", "attachment needs contentHash, url or content."), ctx.requestId);
  // Idempotency hashes the request without inline content to keep stored hashes small.
  const idemBody = { ...d, attachment: { ...att, content: att.content ? `sha256:${await sha256Hex(att.content)}` : undefined } };
  return idempotent(request, ctx, "createDocument", idemBody, async () => {
    const ids = d.relatedEntity.map((r) => r.id);
    const { data: entities } = await ctx.admin.from("business_entities").select("id").in("id", ids).eq("tenant_id", ctx.tenantId);
    if ((entities ?? []).length !== new Set(ids).size) {
      return { status: 404, body: tmfError(404, "relatedEntityNotFound", "Not Found", "One or more related entities don't exist for this organisation.") };
    }
    const { data: specs } = await ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId });
    const spec = (specs ?? []).find((s) => s.code === d.documentType);
    if (!spec) return { status: 400, body: tmfError(400, "unknownDocumentType", "Bad Request", "This documentType isn't set up for this organisation.") };
    const def = spec.definition as { acceptedMimeTypes?: string[]; maxSizeMb?: number; defaultSensitivity?: string; retentionPolicyRef?: string };
    if (def.acceptedMimeTypes && !def.acceptedMimeTypes.includes(att.mimeType)) return { status: 400, body: tmfError(400, "mimeNotAccepted", "Bad Request", "This file type isn't accepted for this documentType.") };

    // Get the bytes when the client sent them (inline) or pointed at them (url).
    let bytes: Uint8Array | null = null;
    if (att.content) {
      bytes = decodeBase64(att.content);
      if (!bytes) return { status: 400, body: tmfError(400, "invalidContent", "Bad Request", "attachment.content must be base64.") };
      if (bytes.byteLength > MAX_INLINE_BYTES) return { status: 413, body: tmfError(413, "tooLarge", "Payload Too Large", "Inline content is limited to 5 MB; send a url or use the upload address.") };
    } else if (att.url) {
      bytes = await fetchBytes(att.url);
      if (!bytes) return { status: 422, body: tmfError(422, "attachmentUnreachable", "Unprocessable Entity", "We couldn't fetch the attachment url (public https, under 25 MB).") };
    }
    const size = bytes ? bytes.byteLength : sizeBytes(att.size);
    if (def.maxSizeMb && size && size > def.maxSizeMb * 1024 * 1024) return { status: 400, body: tmfError(400, "tooLarge", "Bad Request", "This file is larger than allowed.") };
    const hash = bytes ? await sha256Bytes(bytes) : (att.contentHash as string);
    if (bytes && att.contentHash && att.contentHash !== hash) return { status: 422, body: tmfError(422, "hashMismatch", "Unprocessable Entity", "The file doesn't match contentHash.") };

    const { data: doc, error } = await ctx.admin
      .from("documents")
      .insert({
        tenant_id: ctx.tenantId,
        name: d.name,
        description: d.description ?? null,
        document_type: d.documentType,
        status: "draft",
        // Bytes we received are hash-checked and stored; otherwise the client still has to upload.
        pipeline_state: bytes ? "ready" : "uploading",
        sensitivity: (def.defaultSensitivity ?? "internal") as "public" | "internal" | "confidential" | "restricted",
        retention_policy_id: def.retentionPolicyRef ?? null,
        // The schema allows uploaded/generated only; the activity log records which system sent it.
        origin: "uploaded",
        external_identifier: (d.externalIdentifier ?? []) as unknown as Json,
        ...(d.characteristic ? { characteristic: d.characteristic as unknown as Json } : {}),
      })
      .select("id")
      .single();
    if (error) console.error(JSON.stringify({ op: "tmf.createDocument", requestId: ctx.requestId, code: error.code, message: error.message }));
    if (error || !doc) return { status: 503, body: tmfError(503, "unavailable", "Service Unavailable", "Try again shortly.") };
    const versionId = crypto.randomUUID();
    const storagePath = `${ctx.tenantId}/${versionId}`;
    if (bytes) await ctx.admin.storage.from("documents").upload(storagePath, bytes, { contentType: att.mimeType, upsert: false });
    await ctx.admin.from("document_versions").insert({ id: versionId, document_id: doc.id, tenant_id: ctx.tenantId, label: "1", mime_type: att.mimeType, size_bytes: size ?? null, content_hash: hash, storage_path: storagePath });
    await ctx.admin.from("documents").update({ current_version_id: versionId }).eq("id", doc.id);
    await ctx.admin.from("document_relations").insert(d.relatedEntity.map((r) => ({ document_id: doc.id, entity_id: r.id, role: r.role })));
    const signed = bytes ? null : (await ctx.admin.storage.from("documents").createSignedUploadUrl(storagePath)).data;
    await audit(ctx, "upload", doc.id, bytes ? (att.url ? "Version 1 (fetched from url)" : "Version 1 (sent inline)") : "Version 1");
    const created = await findDoc(ctx, doc.id);
    const [tmf] = created ? await loadTmfDocs(ctx, [created]) : [];
    return { status: 201, body: { ...tmf, ...(signed ? { uploadUrl: signed.signedUrl } : {}) } };
  });
}

/** TMF Document_Update subset we accept. Unknown fields are refused so nothing is silently ignored. */
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    validFor: z.object({ endDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}/) }).optional(),
    status: z.string().max(32).optional(),
    characteristic: z.array(characteristicSchema).max(50).optional(),
    externalIdentifier: z.array(extIdSchema).max(10).optional(),
    relatedEntity: z.array(relatedSchema).max(5).optional(),
    "@type": z.string().max(64).optional(),
  })
  .strict();

const PATCH_TYPES = ["application/merge-patch+json", "application/json"];

/** Same status path, scope and approval gate as /transition. */
async function applyTransition(ctx: SystemCtx, doc: DocRow, target: DocStatus): Promise<{ status: number; body: unknown } | null> {
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
  return null;
}

export async function patchDocument(request: Request, id: string): Promise<Response> {
  const ctype = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (ctype && !PATCH_TYPES.includes(ctype)) {
    return errorReply(tmfError(415, "unsupportedMediaType", "Unsupported Media Type", "Send application/merge-patch+json."), crypto.randomUUID());
  }
  const peek = await request.clone().text();
  let peekBody: Record<string, unknown> = {};
  try {
    const j: unknown = JSON.parse(peek || "{}");
    if (typeof j === "object" && j !== null) peekBody = j as Record<string, unknown>;
  } catch {
    peekBody = {};
  }
  // A status-only change needs the transition/approve scope; other fields need register.
  const tmfTarget = typeof peekBody["status"] === "string" ? targetForTmfStatus(peekBody["status"]) : null;
  const onlyStatus = Object.keys(peekBody).filter((k) => k !== "@type").length === 1 && tmfTarget !== null;
  const ctx = await authenticate(request, onlyStatus && tmfTarget ? scopeForTransition(tmfTarget) : "register");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx);
  if (!parsed.ok) return parsed.res;
  const input = patchSchema.safeParse(parsed.body);
  if (!input.success) return errorReply(tmfError(400, "invalidBody", "Bad Request", "You can change name, description, status, characteristic, externalIdentifier, relatedEntity (add) and validFor.endDateTime."), ctx.requestId);
  const p = input.data;
  let target: DocStatus | null = null;
  if (p.status !== undefined) {
    target = targetForTmfStatus(p.status);
    if (!target) return errorReply(tmfError(400, "invalidStatus", "Bad Request", "status can be created, reviewed, approved, published or archived. Use DELETE to delete."), ctx.requestId);
    if (!onlyStatus && !hasScope(ctx.scopes, scopeForTransition(target))) {
      return errorReply(tmfError(403, "scopeMissing", "Forbidden", `This system key does not include '${scopeForTransition(target)}'.`), ctx.requestId);
    }
  }
  return idempotent(request, ctx, `patch:${id}`, p, async () => {
    const doc = await findDoc(ctx, id);
    if (!doc) return { status: 404, body: tmfError(404, "notFound", "Not Found", "No document with this id.") };
    const { status: _s, "@type": _t, ...fields } = p;
    const editsFields = Object.keys(fields).length > 0;
    if (editsFields && isFrozen(doc.status)) return { status: 409, body: tmfError(409, "frozen", "Conflict", "This document can no longer be changed.") };
    if (p.relatedEntity?.length) {
      const ids = p.relatedEntity.map((r) => r.id);
      const { data: ents } = await ctx.admin.from("business_entities").select("id").in("id", ids).eq("tenant_id", ctx.tenantId);
      if ((ents ?? []).length !== new Set(ids).size) return { status: 404, body: tmfError(404, "relatedEntityNotFound", "Not Found", "One or more related entities don't exist for this organisation.") };
    }
    if (editsFields) {
      // Merge-patch on arrays replaces them, except relatedEntity which only adds (links are never removed by systems).
      const merged = p.characteristic
        ? [...asCharacteristicRows(doc.characteristic).filter((c) => !p.characteristic?.some((n) => n.name === c.name)), ...p.characteristic]
        : null;
      await ctx.admin
        .from("documents")
        .update({
          ...(p.name ? { name: p.name } : {}),
          ...(p.description !== undefined ? { description: p.description } : {}),
          ...(p.validFor ? { expiry_date: p.validFor.endDateTime.slice(0, 10) } : {}),
          ...(merged ? { characteristic: merged as unknown as Json } : {}),
          ...(p.externalIdentifier ? { external_identifier: p.externalIdentifier as unknown as Json } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", doc.id)
        .eq("tenant_id", ctx.tenantId);
      if (p.relatedEntity?.length) {
        await ctx.admin.from("document_relations").upsert(p.relatedEntity.map((r) => ({ document_id: doc.id, entity_id: r.id, role: r.role })), { onConflict: "document_id,entity_id", ignoreDuplicates: true });
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
  return Array.isArray(v) ? v.filter((c): c is { name: string; value: unknown } => typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string") : [];
}

/** Standard DELETE: same rules as delete in the app (holds and keep-until dates block it). Soft delete; restorable by an admin. */
export async function deleteDocument(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "delete");
  if (ctx instanceof Response) return ctx;
  return idempotent(request, ctx, `delete:${id}`, { id }, async () => {
    const doc = await findDoc(ctx, id);
    if (!doc) return { status: 404, body: tmfError(404, "notFound", "Not Found", "No document with this id.") };
    const today = new Date().toISOString().slice(0, 10);
    const rule = deleteState("tenant_manager", doc.legal_hold, (doc as DocRow & { retain_until?: string | null }).retain_until ?? null, today);
    if (!rule.available) return { status: 409, body: tmfError(409, doc.legal_hold ? "legalHold" : "retention", "Conflict", rule.reason ?? "This document can't be deleted yet.") };
    await ctx.admin.from("documents").update({ deleted_at: new Date().toISOString() }).eq("id", doc.id).eq("tenant_id", ctx.tenantId);
    await audit(ctx, "delete", doc.id, "Deleted");
    return { status: 204, body: null };
  });
}

const STATUS_VALUES = ["in_review", "approved", "effective", "superseded", "expired", "archived"] as const;
const transitionSchema = z.object({ lifecycleState: z.enum(STATUS_VALUES) });

/** Extension (not TMF667): explicit status task. Standard clients can PATCH status instead. */
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
    const fail = await applyTransition(ctx, doc, target);
    if (fail) return fail;
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
  if (!input.success || !(await resolvesPublic(input.data.callback))) {
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
  // signingSecret is an extension: events carry X-Signature-Timestamp and X-Signature: sha256=HMAC(secret, "<timestamp>.<body>").
  return reply(201, { id: data.id, callback: data.callback, query: data.query, signingSecret: secret, "@type": "EventSubscription" }, ctx.requestId);
}

export async function unsubscribe(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "subscribe");
  if (ctx instanceof Response) return ctx;
  if (!z.string().uuid().safeParse(id).success) return notFound(ctx);
  const { data } = await ctx.admin.from("event_subscriptions").delete().eq("id", id).eq("client_id", ctx.clientId).select("id");
  if (!data || data.length === 0) return errorReply(tmfError(404, "notFound", "Not Found", "No subscription with this id."), ctx.requestId);
  return reply(204, null, ctx.requestId);
}

// ---------- unsupported methods and paths ----------

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Without these, an unsupported method falls through to the app page and answers 200 HTML. */
export function otherMethods(allowed: HttpMethod[]): Partial<Record<HttpMethod, () => Response>> {
  const res = () => {
    const r = errorReply(tmfError(405, "methodNotAllowed", "Method Not Allowed", `Use ${allowed.join(" or ")} here.`), crypto.randomUUID());
    r.headers.set("Allow", allowed.join(", "));
    return r;
  };
  return Object.fromEntries(METHODS.filter((m) => !allowed.includes(m)).map((m) => [m, res]));
}

export function unknownPath(): Response {
  return errorReply(tmfError(404, "notFound", "Not Found", "No API resource at this address."), crypto.randomUUID());
}
