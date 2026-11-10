// Shared write pipeline for the document seam. Receives the caller client (RLS) and the admin
// client from the server-function handler; never imports server-only modules itself.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
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

export async function loadRole(caller: Db, userId: string): Promise<{ tenantId: string; role: AppRole } | null> {
  const { data } = await caller.from("user_roles").select("tenant_id, role").eq("user_id", userId).maybeSingle();
  return data ? { tenantId: data.tenant_id, role: data.role } : null;
}

/** Only operation, tenant, document, status and duration are ever logged. */
function logOp(op: string, tenantId: string | null, documentId: string | null, status: string, started: number) {
  console.info(JSON.stringify({ op, tenant: tenantId, documentId, status, ms: Date.now() - started }));
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

interface RunOptions {
  op: string;
  idempotencyKey: string;
  body: unknown;
  /** Visibility is confirmed as the caller before any privileged write. Null for create/restore. */
  documentId: string | null;
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
    const res = await fn({ caller: ctx.supabase, userId: ctx.userId, tenantId: r.tenantId, role: r.role });
    logOp(op, r.tenantId, documentId, res.ok ? "ok" : res.error.code, started);
    return res;
  } catch {
    logOp(op, r.tenantId, documentId, "error", started);
    return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
  }
}

export async function runWrite<T>(
  ctx: CallerContext,
  admin: Db,
  opts: RunOptions,
  fn: (env: WriteEnv) => Promise<SeamResult<T>>,
): Promise<SeamResult<T>> {
  const started = Date.now();
  const r = await loadRole(ctx.supabase, ctx.userId);
  if (!r) return { ok: false, error: seamError("access.none", "rejected", "contactSupport") };
  const env: WriteEnv = { caller: ctx.supabase, admin, userId: ctx.userId, tenantId: r.tenantId, role: r.role };
  const operation = `document.${opts.op}`;

  try {
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
      logOp(opts.op, env.tenantId, opts.documentId, "conflict", started);
      return { ok: false, error: seamError("seam.idempotency.mismatch", "conflict", "none") };
    }
    if (outcome.kind === "replay") {
      logOp(opts.op, env.tenantId, opts.documentId, "replay", started);
      return outcome.response as SeamResult<T>;
    }

    if (opts.documentId) {
      const { data: visible } = await ctx.supabase.rpc("can_see_document", { _doc: opts.documentId });
      if (!visible) {
        await audit(env, "accessDenied", null, operation);
        logOp(opts.op, env.tenantId, opts.documentId, "notFound", started);
        return { ok: false, error: seamError("doc.notFound", "notFound", "none") };
      }
    }

    const res = await fn(env);
    if (res.ok) {
      await admin.from("idempotency_keys").insert({
        tenant_id: env.tenantId,
        actor: env.userId,
        key: opts.idempotencyKey,
        operation,
        request_hash: requestHash,
        response: res as unknown as Database["public"]["Tables"]["idempotency_keys"]["Insert"]["response"],
      });
    }
    logOp(opts.op, env.tenantId, opts.documentId, res.ok ? "ok" : res.error.code, started);
    return res;
  } catch {
    logOp(opts.op, env.tenantId, opts.documentId, "error", started);
    return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
  }
}

export function forbidden(): SeamErr {
  return { ok: false, error: seamError("access.roleTooLow", "rejected", "contactSupport") };
}
