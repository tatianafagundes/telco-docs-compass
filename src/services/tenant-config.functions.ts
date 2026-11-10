import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { can, seamError, type SeamResult } from "@/services/document-rules";
import { audit, forbidden, runRead, runWrite, type Db } from "@/services/seam-runtime";
import { configChangeBlocker, type HardFloors, type InheritMode, SPEC_SETTINGS } from "@/services/tenant-rules";

/**
 * Shared configuration between the group and its countries. The group admin sees counts and
 * settings of its child tenants, never document names or content. Writes check role, locks,
 * inheritance mode and hard floors here, then use the service role and write an audit event.
 */

async function adminClient(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

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
  definition: Record<string, unknown>;
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

async function loadTenant(db: Db, tenantId: string): Promise<TenantInfo | null> {
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

async function loadView(db: Db, tenantId: string): Promise<ConfigView | null> {
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
      definition: (s.definition ?? {}) as Record<string, unknown>,
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

const isAdmin = (role: string) => role === "tenant_admin" || role === "master_admin";

/** Own configuration for Admin pages. */
export const getConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeamResult<ConfigView>> =>
    runRead(context, "config.get", null, async (env) => {
      // Managers read it too: the Holds and retention page shows the policies in force.
      if (!can(env.role, "manage")) return forbidden();
      const view = await loadView(env.caller, env.tenantId);
      return view ? { ok: true, data: view } : { ok: false, error: seamError("tenant.notFound", "notFound") };
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
        const { data: specs } = await env.caller.rpc("effective_specifications", { p_tenant: k.id });
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
  .inputValidator((i: { tenantId: string }) => z.object({ tenantId: z.string().min(1).max(64) }).parse(i))
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
  .handler(async ({ data, context }): Promise<SeamResult<{ children: number; overridden: number }>> =>
    runRead(context, "config.usage", null, async (env) => {
      if (env.role !== "master_admin") return forbidden();
      const { data: kids } = await env.caller.from("tenants").select("id").eq("parent_tenant_id", env.tenantId);
      const ids = (kids ?? []).map((k) => k.id);
      const { data: own } = ids.length
        ? await env.caller.from("document_specifications").select("tenant_id").eq("code", data.code).in("tenant_id", ids)
        : { data: [] };
      return { ok: true, data: { children: ids.length, overridden: new Set((own ?? []).map((o) => o.tenant_id)).size } };
    }),
  );

const settingValue = z.union([z.string().max(64), z.boolean()]);
const saveSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  code: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{1,40}$/),
  name: z.string().trim().min(1).max(80).optional(),
  changes: z.record(z.enum(SPEC_SETTINGS), settingValue),
  /** Group only. */
  locked: z.boolean().optional(),
});

function describe(v: unknown): string {
  return v === undefined || v === null ? "unset" : String(v);
}

export const saveSpecification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof saveSchema>) => saveSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "config.saveSpecification", idempotencyKey, body, documentId: null }, async (env) => {
      const view = await loadView(env.caller, env.tenantId);
      if (!view) return { ok: false, error: seamError("tenant.notFound", "notFound") };
      const t = view.tenant;
      const current = view.specs.find((s) => s.code === data.code);
      const fromGroup = !!current && current.definedIn === "master" || !!current?.overridden;
      const retRef = data.changes.retentionPolicyRef;
      const policy = typeof retRef === "string" ? view.retention.find((r) => r.id === retRef) : undefined;
      if (typeof retRef === "string" && !policy) return { ok: false, error: seamError("config.unknownPolicy", "validation", "fixInput") };
      if (data.locked !== undefined && !t.isGroup) return forbidden();
      const blocker = configChangeBlocker({
        role: env.role,
        isGroupTenant: t.isGroup,
        specMode: t.inheritance["documentSpecifications"]?.mode,
        locked: !!current?.locked,
        fromGroup,
        changes: data.changes,
        retentionDays: policy?.retainDays ?? null,
        floors: t.floors,
        groupName: t.groupName,
      });
      if (blocker) return { ok: false, error: blocker };

      // Group edits its own row; a country writes its own override (or a new type).
      const { data: own } = await env.admin
        .from("document_specifications")
        .select("id, definition, name")
        .eq("tenant_id", env.tenantId)
        .eq("code", data.code)
        .maybeSingle();
      const before = (own?.definition ?? {}) as Record<string, unknown>;
      const after = { ...before, ...data.changes };
      if (own) {
        await env.admin
          .from("document_specifications")
          .update({
            definition: after as Json,
            ...(data.name ? { name: data.name } : {}),
            ...(data.locked !== undefined ? { locked: data.locked } : {}),
          })
          .eq("id", own.id);
      } else {
        await env.admin.from("document_specifications").insert({
          id: `spec-${env.tenantId}-${data.code}`.slice(0, 80),
          tenant_id: env.tenantId,
          code: data.code,
          name: data.name ?? current?.name ?? data.code,
          definition: after as Json,
          locked: false,
        });
      }
      const effective = current?.definition ?? {};
      for (const [k, v] of Object.entries(data.changes)) {
        await audit(env, "configChange", null, `${data.code}.${k}: ${describe(effective[k])} to ${describe(v)}`);
      }
      if (data.locked !== undefined) await audit(env, "configChange", null, `${data.code}.locked: ${data.locked}`);
      return { ok: true, data: { code: data.code } };
    });
  });

const resetSchema = z.object({ idempotencyKey: z.string().min(8).max(128), code: z.string().min(1).max(64) });

/** Removes a country's override so the group's version applies again. */
export const resetSpecification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof resetSchema>) => resetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "config.resetSpecification", idempotencyKey, body, documentId: null }, async (env) => {
      if (!isAdmin(env.role)) return forbidden();
      const t = await loadTenant(env.caller, env.tenantId);
      if (!t || t.isGroup) return forbidden();
      const { data: groupRow } = await env.caller
        .from("document_specifications")
        .select("id")
        .eq("tenant_id", t.groupId ?? "")
        .eq("code", data.code)
        .maybeSingle();
      // Only overrides can be reset; a country's own type has no group version.
      if (!groupRow) return { ok: false, error: seamError("config.notOverridden", "validation") };
      await env.admin.from("document_specifications").delete().eq("tenant_id", env.tenantId).eq("code", data.code);
      await audit(env, "configChange", null, `${data.code}: reset to group`);
      return { ok: true, data: { code: data.code } };
    });
  });
