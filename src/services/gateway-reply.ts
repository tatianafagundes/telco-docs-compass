// How the gateway builds its answers: JSON, a request id, no caching, plus the headers a status
// calls for (`WWW-Authenticate` on 401, `Location` on 201 when the body has an href).
//
// Does not decide the status or the body: the handlers in tmf-gateway.ts do.
import type { TmfError } from "@/services/tmf667-mapper";

/** Headers a status implies, so no handler has to remember them. */
function headersFor(status: number, body: unknown): Record<string, string> {
  if (status === 401) return { "WWW-Authenticate": 'Bearer realm="document-api"' };
  const href = (body as { href?: unknown } | null)?.href;
  if (status === 201 && typeof href === "string") return { Location: href };
  return {};
}

export function reply(
  status: number,
  body: unknown,
  requestId: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "X-Request-ID": requestId,
      "Cache-Control": "no-store",
      ...headersFor(status, body),
      ...extra,
    },
  });
}

export function errorReply(e: TmfError, requestId: string): Response {
  return reply(Number(e.status), e, requestId);
}
