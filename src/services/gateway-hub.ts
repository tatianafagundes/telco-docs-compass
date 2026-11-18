// Event subscriptions of the TMF gateway (TMF688 pattern): subscribe and unsubscribe a callback.
import { z } from "zod";
import { resolvesPublic } from "@/services/gateway-fetch";
import { must } from "@/services/shared/must";
import { tmfError } from "@/services/tmf667-mapper";
import { errorReply, reply } from "@/services/gateway-reply";
import { authenticate, notFound, readJson } from "@/services/gateway-core";
// ---------- events hub (TMF688 pattern) ----------

const hubSchema = z.object({
  callback: z.string().url().max(500),
  query: z.string().max(300).optional(),
});

export async function subscribe(request: Request): Promise<Response> {
  const ctx = await authenticate(request, "subscribe");
  if (ctx instanceof Response) return ctx;
  const parsed = await readJson(request, ctx);
  if (!parsed.ok) return parsed.res;
  const input = hubSchema.safeParse(parsed.body);
  if (!input.success || !(await resolvesPublic(input.data.callback))) {
    return errorReply(
      tmfError(400, "invalidCallback", "Bad Request", "callback must be a public https address."),
      ctx.requestId,
    );
  }
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(secretBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const { data } = await ctx.admin
    .from("event_subscriptions")
    .insert({
      client_id: ctx.clientId,
      tenant_id: ctx.tenantId,
      callback: input.data.callback,
      query: input.data.query ?? null,
      secret,
    })
    .select("id, callback, query")
    .single();
  if (!data)
    return errorReply(
      tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."),
      ctx.requestId,
    );
  // signingSecret is shown once; events carry X-Signature-Timestamp and X-Signature: sha256=HMAC(secret, "<timestamp>.<body>").
  return reply(
    201,
    {
      id: data.id,
      callback: data.callback,
      query: data.query,
      signingSecret: secret,
      "@type": "EventSubscription",
    },
    ctx.requestId,
  );
}

export async function unsubscribe(request: Request, id: string): Promise<Response> {
  const ctx = await authenticate(request, "subscribe");
  if (ctx instanceof Response) return ctx;
  if (!z.string().uuid().safeParse(id).success) return notFound(ctx);
  const { data } = await ctx.admin
    .from("event_subscriptions")
    .delete()
    .eq("id", id)
    .eq("client_id", ctx.clientId)
    .select("id");
  if (!data || data.length === 0)
    return errorReply(
      tmfError(404, "notFound", "Not Found", "No subscription with this id."),
      ctx.requestId,
    );
  return reply(204, null, ctx.requestId);
}
