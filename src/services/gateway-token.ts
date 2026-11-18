// POST /oauth/token: swaps a system key for a short-lived bearer token (client_credentials).
// The token carries the permissions the key has when it is used, and stops working as soon as the
// key is rotated or revoked (those operations remove its tokens).
//
// Does not check scopes of the API calls (`authenticate` in tmf-gateway.ts does).
//
// Abuse limits, so a leaked or wrong key cannot be guessed at or turned into a pile of tokens:
// - a request budget per caller address, spent before anything is looked up;
// - a request budget per system once its key is recognised;
// - a cap on tokens alive at once for one system.
// The budgets live in this server instance's memory, so across instances they are approximate.
import { readRequestText } from "@/services/gateway-body";
import { createWindowLimiter } from "@/services/rate-limit-rules";
import { must } from "@/services/shared/must";
import { sha256Hex } from "@/services/tmf667-mapper";
import type { Db } from "@/services/seam-runtime";

export const TOKEN_TTL_SECONDS = 900;
/** Token requests one caller address may make per minute, whatever key it sends. */
export const TOKEN_REQUESTS_PER_ADDRESS_PER_MINUTE = 10;
/** Token requests one system may make per minute with a valid key. */
export const TOKEN_REQUESTS_PER_SYSTEM_PER_MINUTE = 20;
/** Tokens one system may hold at once. A token lasts `TOKEN_TTL_SECONDS`, so this is also a per-15-minutes cap. */
export const MAX_ACTIVE_TOKENS = 10;
/** Exported so tests can start from empty budgets. */
export const tokenLimiters = {
  byAddress: createWindowLimiter(TOKEN_REQUESTS_PER_ADDRESS_PER_MINUTE, 60_000),
  bySystem: createWindowLimiter(TOKEN_REQUESTS_PER_SYSTEM_PER_MINUTE, 60_000),
};
/**
 * The address the platform in front of the app reports for the caller. Only that header is
 * trusted: X-Forwarded-For is written by the caller, so using it would let anyone pick their own
 * budget. Without it, every request shares one budget.
 */
function callerAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
function tooMany(description = "Too many token requests. Wait a minute and try again."): Response {
  const r = oauthError(429, "temporarily_unavailable", description);
  r.headers.set("Retry-After", "60");
  return r;
}

function oauthError(status: number, error: string, description: string): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

/**
 * Swaps a system key (client_secret, or HTTP Basic password) for a 15-minute bearer token with the
 * same permissions. client_id is the key's prefix shown in Connected systems.
 */
export async function issueToken(request: Request): Promise<Response> {
  if (tokenLimiters.byAddress.hit(callerAddress(request)) !== "record") return tooMany();
  const { value: text, tooLarge } = await readRequestText(request, 4000);
  if (tooLarge) return oauthError(400, "invalid_request", "Request too large.");
  const ctype = request.headers.get("content-type") ?? "";
  const form = ctype.includes("application/json")
    ? new URLSearchParams(
        Object.entries(
          (() => {
            try {
              return JSON.parse(text) as Record<string, string>;
            } catch {
              return {};
            }
          })(),
        ),
      )
    : new URLSearchParams(text);
  if (form.get("grant_type") !== "client_credentials")
    return oauthError(400, "unsupported_grant_type", "Use grant_type=client_credentials.");
  let secret = form.get("client_secret");
  const basic = /^Basic\s+(.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!secret && basic?.[1]) {
    try {
      secret = atob(basic[1]).split(":").slice(1).join(":");
    } catch {
      secret = null;
    }
  }
  if (!secret || !/^erad_[A-Za-z0-9_-]{20,120}$/.test(secret))
    return oauthError(401, "invalid_client", "Send the system key as client_secret.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as Db;
  const { data: client } = await admin
    .from("integration_clients")
    .select("id, scopes, revoked_at, expires_at")
    .eq("key_hash", await sha256Hex(secret))
    .maybeSingle();
  if (
    !client ||
    client.revoked_at ||
    (client.expires_at && new Date(client.expires_at) <= new Date())
  )
    return oauthError(401, "invalid_client", "This system key is not valid.");
  if (tokenLimiters.bySystem.hit(client.id) !== "record") return tooMany();
  const alive = must(
    await admin
      .from("integration_tokens")
      .select("id")
      .eq("client_id", client.id)
      .gt("expires_at", new Date().toISOString())
      .limit(MAX_ACTIVE_TOKENS),
    "counting the access tokens of a system",
  );
  if ((alive?.length ?? 0) >= MAX_ACTIVE_TOKENS)
    return tooMany(
      "This system already has the most access tokens it may hold. Reuse one until it expires.",
    );
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = `eradt_${Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const expires = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();
  must(
    await admin
      .from("integration_tokens")
      .insert({ client_id: client.id, token_hash: await sha256Hex(token), expires_at: expires }),
    "saving an access token",
  );
  return new Response(
    JSON.stringify({
      access_token: token,
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SECONDS,
      scope: client.scopes.join(" "),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

/** Called when a system's key is rotated or revoked: tokens made with the old key stop working. */
export async function removeTokensOf(admin: Db, clientId: string): Promise<void> {
  must(
    await admin.from("integration_tokens").delete().eq("client_id", clientId),
    "removing the access tokens of a system",
  );
}
