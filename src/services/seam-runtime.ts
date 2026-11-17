// Shared write pipeline for the document seam. Receives the caller client (RLS) and the admin
// client from the server-function handler; never imports server-only modules itself.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  hashBody,
  IDEMPOTENCY_TTL_HOURS,
  idempotencyOutcome,
  seamError,
  type AppRole,
  type SeamErr,
  type SeamResult,
} from "@/services/document-rules";

export type Db = SupabaseClient<Database>;

export interface WriteEnv {
  caller: Db;
  admin: Db;
  userId: string;
  tenantId: string;
  role: AppRole;
}

export interface CallerContext {
  supabase: Db;
  userId: string;
}

export async function loadRole(
  caller: Db,
  userId: string,
): Promise<{ tenantId: string; role: AppRole } | null> {
  const { data } = await caller
    .from("user_roles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? { tenantId: data.tenant_id, role: data.role } : null;
}

/** Only operation, tenant, document, status and duration are ever logged. */
function logOp(
  op: string,
  tenantId: string | null,
  documentId: string | null,
  status: string,
  started: number,
) {
  console.info(
    JSON.stringify({ op, tenant: tenantId, documentId, status, ms: Date.now() - started }),
  );
}

export async function audit(
  env: WriteEnv,
  action: string,
  documentId: string | null,
  detail: string | null = null,
  versionId: string | null = null,
) {
  await env.admin.from("document_events").insert({
    tenant_id: env.tenantId,
    document_id: documentId,
    version_id: versionId,
    actor: env.userId,
    action,
    detail: detail ? detail.slice(0, 160) : null,
  });
}

/**
 * What a write acts on. Required, so a new write cannot skip the document checks by forgetting a field.
 * - `doc`: one existing document. It must be visible to the caller AND belong to the caller's tenant
 *   (a read-only share from another tenant lets you see a document, never change it).
 * - `tenant`: acts inside the caller's own tenant (creating a document, config, purge, restore).
 *   The handler resolves its own targets and must filter them by `env.tenantId`.
 */
export type WriteScope = { kind: "doc"; id: string } | { kind: "tenant" };

interface RunOptions {
  op: string;
  idempotencyKey: string;
  body: unknown;
  scope: WriteScope;
}

export async function runRead<T>(
  ctx: CallerContext,
  op: string,
  documentId: string | null,
  fn: (env: Omit<WriteEnv, "admin">) => Promise<SeamResult<T>>,
): Promise<SeamResult<T>> {
  const started = Date.now();
  const r = await loadRole(ctx.supabase, ctx.userId);
  if (!r) return { ok: false, error: seamError("access.none", "rejected", "contactSupport") };
  try {
    const res = await fn({
      caller: ctx.supabase,
      userId: ctx.userId,
      tenantId: r.tenantId,
      role: r.role,
    });
    logOp(op, r.tenantId, documentId, res.ok ? "ok" : res.error.code, started);
    return res;
  } catch {
    logOp(op, r.tenantId, documentId, "error", started);
    return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
  }
}

/**
 * The single door for every write. Order matters and is the same for every operation:
 *   1. who is the caller (role, tenant)
 *   2. may they touch this document (visible AND same tenant), before anything is replayed
 *   3. idempotency (same key + same body replays the stored answer; same key + other body conflicts)
 *   4. the handler, then the stored answer
 * Checking access before the replay means revoked access can never be bypassed by an old request.
 */
export async function runWrite<T>(
  ctx: CallerContext,
  admin: Db,
  opts: RunOptions,
  fn: (env: WriteEnv) => Promise<SeamResult<T>>,
): Promise<SeamResult<T>> {
  const started = Date.now();
  const documentId = opts.scope.kind === "doc" ? opts.scope.id : null;
  const r = await loadRole(ctx.supabase, ctx.userId);
  if (!r) return { ok: false, error: seamError("access.none", "rejected", "contactSupport") };
  const env: WriteEnv = {
    caller: ctx.supabase,
    admin,
    userId: ctx.userId,
    tenantId: r.tenantId,
    role: r.role,
  };
  const operation = `document.${opts.op}`;

  try {
    if (opts.scope.kind === "doc") {
      const denied = await documentAccessDenied(ctx, env, opts.scope.id, operation);
      if (denied) {
        logOp(opts.op, env.tenantId, documentId, "notFound", started);
        return denied;
      }
    }

    const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_HOURS * 3600_000).toISOString();
    await admin.from("idempotency_keys").delete().lt("created_at", cutoff);

    const requestHash = await hashBody(opts.body);
    const { data: stored } = await admin
      .from("idempotency_keys")
      .select("request_hash, response")
      .eq("tenant_id", env.tenantId)
      .eq("actor", env.userId)
      .eq("key", opts.idempotencyKey)
      .eq("operation", operation)
      .maybeSingle();
    const outcome = idempotencyOutcome(stored, requestHash);
    if (outcome.kind === "conflict") {
      logOp(opts.op, env.tenantId, documentId, "conflict", started);
      return { ok: false, error: seamError("seam.idempotency.mismatch", "conflict", "none") };
    }
    if (outcome.kind === "replay") {
      logOp(opts.op, env.tenantId, documentId, "replay", started);
      return outcome.response as SeamResult<T>;
    }

    const res = await fn(env);
    if (res.ok) {
      await admin.from("idempotency_keys").insert({
        tenant_id: env.tenantId,
        actor: env.userId,
        key: opts.idempotencyKey,
        operation,
        request_hash: requestHash,
        response: res as unknown as Json,
      });
    }
    logOp(opts.op, env.tenantId, documentId, res.ok ? "ok" : res.error.code, started);
    return res;
  } catch {
    logOp(opts.op, env.tenantId, documentId, "error", started);
    return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
  }
}

/**
 * Null when the caller may write to this document; otherwise the `notFound` answer.
 * A document the caller cannot see and a document of another tenant look the same on purpose.
 * A failed lookup throws, so the caller gets "unavailable" instead of a silent pass (fail closed).
 */
async function documentAccessDenied(
  ctx: CallerContext,
  env: WriteEnv,
  documentId: string,
  operation: string,
): Promise<SeamErr | null> {
  const notFound: SeamErr = { ok: false, error: seamError("doc.notFound", "notFound", "none") };
  const { data: visible } = await ctx.supabase.rpc("can_see_document", { _doc: documentId });
  if (!visible) {
    await audit(env, "accessDenied", null, operation);
    return notFound;
  }
  const { data: doc, error } = await env.admin
    .from("documents")
    .select("tenant_id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error("document lookup failed");
  if (!doc || doc.tenant_id !== env.tenantId) {
    await audit(env, "accessDenied", null, `${operation} (other tenant)`);
    return notFound;
  }
  return null;
}

export function forbidden(): SeamErr {
  return { ok: false, error: seamError("access.roleTooLow", "rejected", "contactSupport") };
}
