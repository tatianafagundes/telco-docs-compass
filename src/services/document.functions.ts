import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Document seam (contracts/seams/document.openapi.yaml) as authenticated server functions.
 * Reads run as the caller, so RLS decides visibility. Writes use the service role only after
 * the caller's role and access are checked here, and every write appends its own audit event.
 */

export const getMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const { data: role } = await supabase
      .from("user_roles")
      .select("role, tenant_id, display_name")
      .eq("user_id", userId)
      .maybeSingle();
    if (!role) return { userId, email: String(claims.email ?? ""), access: null };
    const { data: tenant } = await supabase
      .from("tenants")
      .select("display_name")
      .eq("id", role.tenant_id)
      .maybeSingle();
    return {
      userId,
      email: String(claims.email ?? ""),
      access: {
        role: role.role,
        tenantId: role.tenant_id,
        tenantName: tenant?.display_name ?? role.tenant_id,
        displayName: role.display_name ?? String(claims.email ?? ""),
      },
    };
  });

export const listEntities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("business_entities")
      .select("id, referred_type, display_name, status_label")
      .order("display_name");
    if (error) throw new Error("entities.loadFailed");
    return data;
  });

const idInput = z.object({ id: z.string().uuid() });

export const get = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: doc, error } = await context.supabase
      .from("documents")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error("documents.loadFailed");
    return doc; // null when RLS hides it: the caller shows "not found or no access"
  });

export const listVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("document_versions")
      .select("id, label, is_named, note, mime_type, size_bytes, content_hash, sample_pages, supersedes, created_at")
      .eq("document_id", data.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error("versions.loadFailed");
    return rows;
  });

export const getExtraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("extraction_fields")
      .select("id, version_id, name, value, original_value, confidence, band, source, status, spot_check, reviewed_at")
      .eq("document_id", data.id);
    if (error) throw new Error("extraction.loadFailed");
    return rows;
  });

export const listSpecifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("effective_specifications");
    if (error) throw new Error("specifications.loadFailed");
    return data;
  });

export const getTenantPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: tenantId } = await context.supabase.rpc("user_tenant");
    if (!tenantId) throw new Error("access.none");
    const { data, error } = await context.supabase
      .from("tenants")
      .select("id, display_name, role, parent_tenant_id, cross_tenant_share, master_supervision, hard_floors, inheritance")
      .eq("id", tenantId)
      .maybeSingle();
    if (error || !data) throw new Error("tenant.loadFailed");
    return data;
  });

/** Clients may only record view and download; every other audit action is written by its operation. */
export const RECORDABLE_ACTIONS = ["view", "download"] as const;
const recordInput = z.object({
  id: z.string().uuid(),
  action: z.enum(RECORDABLE_ACTIONS),
  versionId: z.string().uuid().optional(),
});

export const recordAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof recordInput>) => recordInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: visible } = await context.supabase.rpc("can_see_document", { _doc: data.id });
    const { data: tenantId } = await context.supabase.rpc("user_tenant");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!tenantId) throw new Error("access.none");
    if (!visible) {
      await supabaseAdmin.from("document_events").insert({
        tenant_id: tenantId, document_id: null, actor: context.userId, action: "accessDenied", detail: data.action,
      });
      throw new Error("access.denied");
    }
    await supabaseAdmin.from("document_events").insert({
      tenant_id: tenantId, document_id: data.id, version_id: data.versionId ?? null,
      actor: context.userId, action: data.action, detail: null,
    });
    return { ok: true };
  });

export const listActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => idInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("document_events")
      .select("id, action, detail, created_at")
      .eq("document_id", data.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error("activity.loadFailed");
    return rows;
  });

const searchInput = z.object({ query: z.string().trim().max(80) });

/** People in the caller's own organisation only (profiles RLS: same tenant). At most 20. */
export const searchPeople = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { query: string }) => searchInput.parse(input))
  .handler(async ({ data, context }) => {
    const like = data.query.replace(/[%_,()]/g, " ");
    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("user_id, display_name")
      .neq("user_id", context.userId)
      .ilike("display_name", `%${like}%`)
      .order("display_name")
      .limit(20);
    if (error) throw new Error("people.loadFailed");
    return rows.map((r) => ({ id: r.user_id, name: r.display_name }));
  });
