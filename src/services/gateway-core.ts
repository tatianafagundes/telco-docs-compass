// Shared core of the TMF gateway: who is calling (`authenticate`), reading a JSON body, loading a
// document in the TMF shape, and the answers every handler uses.
// Routes under /api/public/tmf-api/* skip site auth, so every handler starts with authenticate().
// The admin client is loaded only after the system key is verified, and every query is pinned to
// the key's tenant.
//
// Does not implement any one operation: see gateway-reads.ts, gateway-create.ts,
// gateway-patch.ts, gateway-changes.ts and gateway-hub.ts.
import { decideRate, rateHeaders, rateKind, retryGuidance } from "@/services/rate-limit-rules";
import { z } from "zod";
import { resolvesPublic } from "@/services/gateway-fetch";
import { readRequestText, type Limited } from "@/services/gateway-body";
import type { Db } from "@/services/seam-runtime";
import { MAX_INLINE_BYTES } from "@/services/gateway-create-input";
import {
  hasScope,
  readBearer,
  sha256Hex,
  tmfError,
  toTmfDocument,
  type DocRow,
  type RelationRow,
  type Scope,
  type VersionRow,
  categoryFromDefinition,
} from "@/services/tmf667-mapper";
import { errorReply } from "@/services/gateway-reply";
export const MAX_BODY_CHARS = 50_000;
/** Per key, per minute. */

export interface SystemCtx {
  admin: Db;
  clientId: string;
  name: string;
  tenantId: string;
  scopes: string[];
  origin: string;
  requestId: string;
}

export const DOC_COLS =
  "id, tenant_id, name, description, document_type, status, sensitivity, legal_hold, effective_date, expiry_date, created_at, updated_at, current_version_id, characteristic, external_identifier, retain_until, bundle_id, registered_by_client";

/**
 * Verifies the system key (erad_…) or a short-lived OAuth token (eradt_…), checks expiry, scope and
 * the per-minute rate limit, and returns a tenant-pinned context, or an error response.
 */
export async function authenticate(request: Request, needed: Scope): Promise<SystemCtx | Response> {
  const requestId = crypto.randomUUID();
  const key = readBearer(request.headers.get("authorization"));
  if (!key)
    return errorReply(
      tmfError(
        401,
        "unauthorized",
        "Unauthorized",
        "Send a system key or access token as 'Authorization: Bearer …'.",
      ),
      requestId,
    );
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as Db;
  let clientId: string | null = null;
  if (key.startsWith("eradt_")) {
    const { data: tok } = await admin
      .from("integration_tokens")
      .select("client_id, expires_at")
      .eq("token_hash", await sha256Hex(key))
      .maybeSingle();
    if (tok && new Date(tok.expires_at) > new Date()) clientId = tok.client_id;
  }
  const base = admin
    .from("integration_clients")
    .select(
      "id, name, tenant_id, scopes, revoked_at, expires_at, read_limit_per_minute, write_limit_per_minute",
    );
  const { data: client } = clientId
    ? await base.eq("id", clientId).maybeSingle()
    : key.startsWith("erad_")
      ? await base.eq("key_hash", await sha256Hex(key)).maybeSingle()
      : { data: null };
  const expired = client?.expires_at ? new Date(client.expires_at) <= new Date() : false;
  if (!client || client.revoked_at || expired) {
    return errorReply(
      tmfError(
        401,
        "unauthorized",
        "Unauthorized",
        expired
          ? "This system key has expired. Ask an administrator for a new key."
          : "This system key is not valid.",
      ),
      requestId,
    );
  }
  if (!hasScope(client.scopes, needed)) {
    return errorReply(
      tmfError(403, "scopeMissing", "Forbidden", `This system key does not include '${needed}'.`),
      requestId,
    );
  }
  // Each system has its own counter and allowance, so one busy system never uses up another's.
  const kind = rateKind(request.method);
  const limit = kind === "read" ? client.read_limit_per_minute : client.write_limit_per_minute;
  const { data: hits } = await admin.rpc("api_hit", { p_client: client.id, p_kind: kind });
  const decision = decideRate(typeof hits === "number" ? hits : 0, limit, new Date());
  if (!decision.allowed) {
    await admin
      .from("integration_clients")
      .update({ last_rate_limited_at: new Date().toISOString() })
      .eq("id", client.id);
    const r = errorReply(
      tmfError(429, "tooManyRequests", "Too Many Requests", retryGuidance(kind, decision)),
      requestId,
    );
    for (const [k, v] of Object.entries(rateHeaders(decision))) r.headers.set(k, v);
    return r;
  }
  await admin
    .from("integration_clients")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", client.id);
  console.info(
    JSON.stringify({
      op: "tmf",
      client: client.id,
      tenant: client.tenant_id,
      scope: needed,
      requestId,
    }),
  );
  return {
    admin,
    clientId: client.id,
    name: client.name,
    tenantId: client.tenant_id,
    scopes: client.scopes,
    origin: new URL(request.url).origin,
    requestId,
  };
}

export const bodyTooLarge = (ctx: SystemCtx) =>
  errorReply(
    tmfError(413, "bodyTooLarge", "Payload Too Large", "Request body is too large."),
    ctx.requestId,
  );
export async function readJson(
  request: Request,
  ctx: SystemCtx,
  maxChars = MAX_BODY_CHARS,
  /** The body, when the caller already read it (to pick the scope before authenticating). */
  alreadyRead?: Limited<string>,
): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const { value: text, tooLarge } = alreadyRead ?? (await readRequestText(request, maxChars));
  if (tooLarge) return { ok: false, res: bodyTooLarge(ctx) };
  try {
    return { ok: true, body: text ? JSON.parse(text) : {} };
  } catch {
    return {
      ok: false,
      res: errorReply(
        tmfError(400, "invalidJson", "Bad Request", "Request body is not valid JSON."),
        ctx.requestId,
      ),
    };
  }
}

export async function loadTmfDocs(ctx: SystemCtx, docs: DocRow[]) {
  const ids = docs.map((d) => d.id);
  if (ids.length === 0) return [];
  const bundles = [...new Set(docs.map((d) => d.bundle_id).filter((b): b is string => !!b))];
  const [{ data: versions }, { data: rels }, { data: specs }, { data: siblings }] =
    await Promise.all([
      ctx.admin
        .from("document_versions")
        .select("id, document_id, label, mime_type, size_bytes, content_hash, created_at")
        .in("document_id", ids)
        .eq("tenant_id", ctx.tenantId)
        .order("created_at"),
      ctx.admin
        .from("document_relations")
        .select("document_id, entity_id, role, business_entities!inner(referred_type, tenant_id)")
        .in("document_id", ids)
        .eq("business_entities.tenant_id", ctx.tenantId),
      ctx.admin.rpc("effective_specifications", { p_tenant: ctx.tenantId }),
      bundles.length
        ? ctx.admin
            .from("documents")
            .select("id, bundle_id, bundle_role")
            .in("bundle_id", bundles)
            .eq("tenant_id", ctx.tenantId)
            .is("deleted_at", null)
            .is("purged_at", null)
        : Promise.resolve({
            data: [] as { id: string; bundle_id: string | null; bundle_role: string | null }[],
          }),
    ]);
  const categoryByType = new Map(
    (specs ?? []).map((s) => [s.code, categoryFromDefinition(s.definition)]),
  );
  return docs.map((d) =>
    toTmfDocument(
      ctx.origin,
      d,
      (versions ?? []).filter((v) => v.document_id === d.id) as VersionRow[],
      (rels ?? [])
        .filter((r) => r.document_id === d.id)
        .map((r): RelationRow => ({
          entity_id: r.entity_id,
          role: r.role,
          referred_type: (r.business_entities as { referred_type: string }).referred_type,
        })),
      {
        category: categoryByType.get(d.document_type) ?? [],
        // Same tenant, same bundle; never links outside the key's tenant.
        related: (siblings ?? [])
          .filter((x) => d.bundle_id && x.bundle_id === d.bundle_id && x.id !== d.id)
          .map((x) => ({ id: x.id, role: x.bundle_role ?? "bundleMember" })),
      },
    ),
  );
}

export async function findDoc(ctx: SystemCtx, id: string): Promise<DocRow | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data } = await ctx.admin
    .from("documents")
    .select(DOC_COLS)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .is("deleted_at", null)
    .is("purged_at", null)
    .maybeSingle();
  return (data as DocRow | null) ?? null;
}

export const notFound = (ctx: SystemCtx) =>
  errorReply(tmfError(404, "notFound", "Not Found", "No document with this id."), ctx.requestId);
