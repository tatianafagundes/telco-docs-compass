// Idempotency-Key handling and the activity record for the TMF gateway: a repeated change returns
// the stored answer, a reused key with another body is refused, and a database failure answers 503
// without remembering anything, so the same key can retry.
//
// Does not decide what a change does: the handlers pass it in as `run`.
import type { Json } from "@/integrations/supabase/types";
import {
  hashBody,
  idempotencyOutcome,
  IDEMPOTENCY_KEY_COLUMNS,
  idempotencyCutoff,
} from "@/services/document-rules";
import { DatabaseError, must } from "@/services/shared/must";
import { tmfError } from "@/services/tmf667-mapper";
import { errorReply, reply } from "@/services/gateway-reply";
import { SystemCtx } from "@/services/gateway-core";
export async function audit(ctx: SystemCtx, action: string, documentId: string, detail: string) {
  must(
    await ctx.admin.from("document_events").insert({
      tenant_id: ctx.tenantId,
      document_id: documentId,
      actor: null,
      action,
      detail: `${detail} · via ${ctx.name}`.slice(0, 160),
    }),
    "recording an activity event",
  );
}

/** A write that hit a database error answers 503, and is not remembered, so the same key can retry. */
async function runOrUnavailable(
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown }> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof DatabaseError)) throw e;
    console.error(JSON.stringify({ op: "tmf.write", step: e.message }));
    return {
      status: 503,
      body: tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."),
    };
  }
}
/** Writes need an Idempotency-Key header; a replay with the same body returns the stored reply. */
export async function idempotent(
  request: Request,
  ctx: SystemCtx,
  operation: string,
  body: unknown,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    return errorReply(
      tmfError(
        400,
        "idempotencyKeyMissing",
        "Bad Request",
        "Send an Idempotency-Key header (8–128 letters, digits, - or _).",
      ),
      ctx.requestId,
    );
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
    .gte("created_at", idempotencyCutoff())
    .maybeSingle();
  const outcome = idempotencyOutcome(stored, requestHash);
  if (outcome.kind === "conflict")
    return errorReply(
      tmfError(
        409,
        "idempotencyMismatch",
        "Conflict",
        "This Idempotency-Key was used with a different body.",
      ),
      ctx.requestId,
    );
  if (outcome.kind === "replay") {
    const r = outcome.response as { status: number; body: unknown };
    return reply(r.status, r.body, ctx.requestId, { "Idempotent-Replay": "true" });
  }
  const res = await runOrUnavailable(run);
  if (res.status < 300 || res.status === 204) {
    await ctx.admin.from("idempotency_keys").upsert(
      {
        tenant_id: ctx.tenantId,
        actor: ctx.clientId,
        key,
        operation: op,
        request_hash: requestHash,
        response: res as unknown as Json,
        created_at: new Date().toISOString(),
      },
      { onConflict: IDEMPOTENCY_KEY_COLUMNS },
    );
  }
  return reply(res.status, res.body, ctx.requestId);
}
