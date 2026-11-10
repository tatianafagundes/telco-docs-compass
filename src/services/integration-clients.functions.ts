import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { seamError, type SeamResult } from "@/services/document-rules";
import { forbidden, runRead, type Db } from "@/services/seam-runtime";
import { SCOPES, sha256Hex, SYSTEM_KINDS } from "@/services/tmf667-mapper";

/**
 * Connected systems: country admins create keys for Order care, Ticket management, CRM or CPQ.
 * Keys are stored hashed; the full key is returned exactly once on create/rotate.
 */

export interface ConnectedSystem {
  id: string;
  name: string;
  systemKind: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  lastRateLimitedAt: string | null;
}

/** New and rotated keys stop working after 12 months. */
export const KEY_LIFETIME_DAYS = 365;
const expiry = () => new Date(Date.now() + KEY_LIFETIME_DAYS * 86_400_000).toISOString();

const isTenantAdmin = (role: string) => role === "tenant_admin";

function newKey(): { key: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  const body = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const key = `erad_${body}`;
  return { key, prefix: key.slice(0, 10) };
}

async function adminClient(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const map = (r: { id: string; name: string; system_kind: string; key_prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null; expires_at: string | null; last_rate_limited_at: string | null }): ConnectedSystem => ({
  id: r.id,
  name: r.name,
  systemKind: r.system_kind,
  keyPrefix: r.key_prefix,
  scopes: r.scopes,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
  expiresAt: r.expires_at,
  lastRateLimitedAt: r.last_rate_limited_at,
});

const COLS = "id, name, system_kind, key_prefix, scopes, created_at, last_used_at, revoked_at, expires_at, last_rate_limited_at";

export const listSystems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeamResult<ConnectedSystem[]>> =>
    runRead(context, "systems.list", null, async (env) => {
      if (!isTenantAdmin(env.role)) return forbidden();
      const { data } = await env.caller.from("integration_clients").select(COLS).eq("tenant_id", env.tenantId).order("created_at", { ascending: false });
      return { ok: true, data: (data ?? []).map(map) };
    }),
  );

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  systemKind: z.enum(SYSTEM_KINDS),
  scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
});

export const createSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createSchema>) => createSchema.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<{ system: ConnectedSystem; key: string }>> =>
    runRead(context, "systems.create", null, async (env) => {
      if (!isTenantAdmin(env.role)) return forbidden();
      const { key, prefix } = newKey();
      const admin = await adminClient();
      const { data: row, error } = await admin
        .from("integration_clients")
        .insert({ tenant_id: env.tenantId, name: data.name, system_kind: data.systemKind, scopes: [...new Set(data.scopes)], key_prefix: prefix, key_hash: await sha256Hex(key), created_by: env.userId, expires_at: expiry() })
        .select(COLS)
        .single();
      if (error || !row) return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
      return { ok: true, data: { system: map(row), key } };
    }),
  );

const idSchema = z.object({ id: z.string().uuid() });

export const rotateSystemKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof idSchema>) => idSchema.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<{ key: string }>> =>
    runRead(context, "systems.rotate", null, async (env) => {
      if (!isTenantAdmin(env.role)) return forbidden();
      const { key, prefix } = newKey();
      const admin = await adminClient();
      const { data: rows } = await admin
        .from("integration_clients")
        .update({ key_hash: await sha256Hex(key), key_prefix: prefix, expires_at: expiry() })
        .eq("id", data.id)
        .eq("tenant_id", env.tenantId)
        .is("revoked_at", null)
        .select("id");
      if (!rows || rows.length === 0) return { ok: false, error: seamError("system.notFound", "notFound", "none") };
      return { ok: true, data: { key } };
    }),
  );

export const revokeSystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof idSchema>) => idSchema.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<{ id: string }>> =>
    runRead(context, "systems.revoke", null, async (env) => {
      if (!isTenantAdmin(env.role)) return forbidden();
      const admin = await adminClient();
      const { data: rows } = await admin
        .from("integration_clients")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", data.id)
        .eq("tenant_id", env.tenantId)
        .select("id");
      if (!rows || rows.length === 0) return { ok: false, error: seamError("system.notFound", "notFound", "none") };
      await admin.from("event_subscriptions").delete().eq("client_id", data.id);
      return { ok: true, data: { id: data.id } };
    }),
  );
