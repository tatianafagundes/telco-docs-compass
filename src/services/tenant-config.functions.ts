import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { can, seamError, type SeamResult } from "@/services/document-rules";
import { audit, forbidden, runRead, type Db } from "@/services/seam-runtime";
import { type HardFloors, type InheritMode } from "@/services/tenant-rules";
import { adminClient } from "@/services/shared/server-context";
export { adminClient };
/**
 * Shared configuration between the group and its countries. The group admin sees counts and
 * settings of its child tenants, never document names or content. Writes check role, locks,
 * inheritance mode and hard floors here, then use the service role and write an audit event.
 */

export interface TenantInfo {
  id: string;
  displayName: string;
  isGroup: boolean;
  groupId: string | null;
  groupName: string;
  inheritance: Record<string, { mode?: InheritMode }>;
  floors: HardFloors;
}

export interface EffectiveSpec {
  id: string;
  code: string;
  name: string;
  locked: boolean;
  definedIn: string | null;
  overridden: boolean;
  overriddenFields: string[];
  definition: { [k: string]: Json | undefined };
}

export interface RetentionPolicy {
  id: string;
  tenantId: string;
  name: string;
  retainDays: number;
  locked: boolean;
}

export interface ConfigView {
  tenant: TenantInfo;
  specs: EffectiveSpec[];
  retention: RetentionPolicy[];
}

export async function loadTenant(db: Db, tenantId: string): Promise<TenantInfo | null> {
  const { data: t } = await db
    .from("tenants")
    .select("id, display_name, parent_tenant_id, hard_floors, inheritance")
    .eq("id", tenantId)
    .maybeSingle();
  if (!t) return null;
  const groupId = t.parent_tenant_id;
  const { data: g } = groupId
    ? await db.from("tenants").select("display_name, hard_floors").eq("id", groupId).maybeSingle()
    : { data: null };
  return {
    id: t.id,
    displayName: t.display_name,
    isGroup: !groupId,
    groupId,
    groupName: g?.display_name ?? t.display_name,
    inheritance: (t.inheritance ?? {}) as TenantInfo["inheritance"],
    floors: ((groupId ? g?.hard_floors : t.hard_floors) ?? {}) as HardFloors,
  };
}

export async function loadView(db: Db, tenantId: string): Promise<ConfigView | null> {
  const tenant = await loadTenant(db, tenantId);
  if (!tenant) return null;
  const { data: specs } = await db.rpc("effective_specifications", { p_tenant: tenantId });
  const ids = [tenantId, ...(tenant.groupId ? [tenant.groupId] : [])];
  const { data: ret } = await db
    .from("retention_policies")
    .select("id, tenant_id, name, retain_days, locked")
    .in("tenant_id", ids)
    .order("name");
  return {
    tenant,
    specs: (specs ?? []).map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      locked: s.locked,
      definedIn: s.defined_in,
      overridden: s.overridden,
      overriddenFields: s.overridden_fields ?? [],
      definition: (s.definition ?? {}) as { [k: string]: Json | undefined },
    })),
    retention: (ret ?? []).map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      retainDays: r.retain_days,
      locked: r.locked,
    })),
  };
}

export const isAdmin = (role: string) => role === "tenant_admin" || role === "master_admin";

/** Own configuration for Admin pages. */
export const getConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeamResult<ConfigView>> =>
    runRead(context, "config.get", null, async (env) => {
      // Managers read it too: the Holds and retention page shows the policies in force.
      if (!can(env.role, "manage")) return forbidden();
      const view = await loadView(env.caller, env.tenantId);
      return view
        ? { ok: true, data: view }
        : { ok: false, error: seamError("tenant.notFound", "notFound") };
    }),
  );

export interface StatRow {
  documentType: string;
  status: string;
  pipelineState: string;
  legalHold: boolean;
  n: number;
}

export interface ChildSummary {
  id: string;
  displayName: string;
  overrides: number;
  adds: number;
  total: number;
  crossTenantShare: string;
  masterSupervision: string;
  stats: StatRow[];
}

async function stats(db: Db, tenantId: string): Promise<StatRow[]> {
  const { data } = await db.rpc("master_document_stats", { p_tenant: tenantId });
  return (data ?? []).map((r) => ({
    documentType: r.document_type,
    status: r.status,
    pipelineState: r.pipeline_state,
    legalHold: r.legal_hold,
    n: Number(r.n),
  }));
}

/** Group admin only: child tenants with counts and configuration differences. */
export const listChildTenants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeamResult<ChildSummary[]>> =>
    runRead(context, "config.children", null, async (env) => {
      if (env.role !== "master_admin") return forbidden();
      const { data: kids } = await env.caller
        .from("tenants")
        .select("id, display_name, cross_tenant_share, master_supervision")
        .eq("parent_tenant_id", env.tenantId)
        .order("display_name");
      const out: ChildSummary[] = [];
      for (const k of kids ?? []) {
        const { data: specs } = await env.caller.rpc("effective_specifications", {
          p_tenant: k.id,
        });
        const st = await stats(env.caller, k.id);
        out.push({
          id: k.id,
          displayName: k.display_name,
          overrides: (specs ?? []).filter((s) => s.overridden).length,
          adds: (specs ?? []).filter((s) => s.defined_in === "tenant" && !s.overridden).length,
          total: st.reduce((a, r) => a + r.n, 0),
          crossTenantShare: k.cross_tenant_share,
          masterSupervision: k.master_supervision,
          stats: st,
        });
      }
      return { ok: true, data: out };
    }),
  );

/** Group admin only: a child's settings and counts, read-only. */
export const getChildView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { tenantId: string }) =>
    z.object({ tenantId: z.string().min(1).max(64) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<SeamResult<ConfigView & { stats: StatRow[] }>> =>
    runRead(context, "config.child", null, async (env) => {
      if (env.role !== "master_admin") return forbidden();
      const { data: child } = await env.caller
        .from("tenants")
        .select("id")
        .eq("id", data.tenantId)
        .eq("parent_tenant_id", env.tenantId)
        .maybeSingle();
      // Same answer for "missing" and "not yours": existence is never revealed.
      if (!child) return { ok: false, error: seamError("tenant.notFound", "notFound") };
      const view = await loadView(env.caller, data.tenantId);
      if (!view) return { ok: false, error: seamError("tenant.notFound", "notFound") };
      return { ok: true, data: { ...view, stats: await stats(env.caller, data.tenantId) } };
    }),
  );

/** Group admin only: how many children use or override a shared type. */
export const specUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { code: string }) => z.object({ code: z.string().min(1).max(64) }).parse(i))
  .handler(
    async ({ data, context }): Promise<SeamResult<{ children: number; overridden: number }>> =>
      runRead(context, "config.usage", null, async (env) => {
        if (env.role !== "master_admin") return forbidden();
        const { data: kids } = await env.caller
          .from("tenants")
          .select("id")
          .eq("parent_tenant_id", env.tenantId);
        const ids = (kids ?? []).map((k) => k.id);
        const { data: own } = ids.length
          ? await env.caller
              .from("document_specifications")
              .select("tenant_id")
              .eq("code", data.code)
              .in("tenant_id", ids)
          : { data: [] };
        return {
          ok: true,
          data: {
            children: ids.length,
            overridden: new Set((own ?? []).map((o) => o.tenant_id)).size,
          },
        };
      }),
  );
