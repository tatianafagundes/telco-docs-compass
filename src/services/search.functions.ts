import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import { can, seamError, type SeamResult } from "@/services/document-rules";
import { forbidden, runRead, type Db } from "@/services/seam-runtime";
import {
  BULK_ACTIONS,
  BULK_LIMIT,
  normaliseFilters,
  PAGE_SIZE,
  searchFiltersSchema,
  SENSITIVITIES,
  splitPage,
  STATUSES,
  type Cursor,
  type SearchFilters,
} from "@/services/search-rules";

/**
 * Search for large document volumes. Visibility is computed set-based inside the database
 * functions (same rule as can_see_document), so the caller only ever gets rows they may see.
 */

export interface SearchRow {
  id: string;
  name: string;
  document_type: string;
  status: DocStatus;
  sensitivity: string;
  legal_hold: boolean;
  updated_at: string;
  expiry_date: string | null;
  pending: number;
  entity_id: string | null;
  entity_name: string | null;
  entity_type: string | null;
}

export interface SearchPage {
  items: SearchRow[];
  next: Cursor | null;
}

const cursorSchema = z.object({ v: z.string().max(300), id: z.string().uuid() });
const pageInput = z.object({ filters: searchFiltersSchema, cursor: cursorSchema.nullable(), limit: z.number().int().min(1).max(PAGE_SIZE).optional() });

const asJson = (f: SearchFilters): Json => normaliseFilters(f) as unknown as Json;

export const searchDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof pageInput>) => pageInput.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<SearchPage>> =>
    runRead(context, "search.page", null, async (env) => {
      const size = data.limit ?? PAGE_SIZE;
      const p = { ...normaliseFilters(data.filters), limit: size + 1, ...(data.cursor ? { cursor: data.cursor } : {}) };
      const { data: rows, error } = await env.caller.rpc("search_documents", { p: p as unknown as Json });
      if (error) return { ok: false, error: seamError("search.failed", "unavailable", "retry") };
      return { ok: true, data: splitPage((rows ?? []) as SearchRow[], data.filters.sort ?? "updated", size) };
    }),
  );

const filtersInput = z.object({ filters: searchFiltersSchema });

export const countDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof filtersInput>) => filtersInput.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<number>> =>
    runRead(context, "search.count", null, async (env) => {
      const { data: n, error } = await env.caller.rpc("count_documents", { p: asJson(data.filters) });
      if (error) return { ok: false, error: seamError("search.failed", "unavailable", "retry") };
      return { ok: true, data: n ?? 0 };
    }),
  );

export type Facets = Record<"types" | "statuses" | "sensitivity" | "hold", Record<string, number>>;

export const facetDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof filtersInput>) => filtersInput.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<Facets>> =>
    runRead(context, "search.facets", null, async (env) => {
      const { data: rows, error } = await env.caller.rpc("facet_documents", { p: asJson(data.filters) });
      if (error) return { ok: false, error: seamError("search.failed", "unavailable", "retry") };
      const out: Facets = { types: {}, statuses: {}, sensitivity: {}, hold: {} };
      for (const r of rows ?? []) {
        const bucket = out[r.facet as keyof Facets];
        if (bucket) bucket[r.value] = Number(r.n);
      }
      return { ok: true, data: out };
    }),
  );

/** Exact record number or name match, for jumping straight to an order, quote or account. */
export const findRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { q: string }) => z.object({ q: z.string().trim().min(2).max(64) }).parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<{ id: string; name: string; type: string }[]>> =>
    runRead(context, "search.record", null, async (env) => {
      const q = data.q.replace(/[%_\\,()]/g, "");
      const { data: rows } = await env.caller
        .from("business_entities")
        .select("id, display_name, referred_type")
        .or(`id.ilike.${q},display_name.ilike.${q}%`)
        .limit(5);
      return { ok: true, data: (rows ?? []).map((r) => ({ id: r.id, name: r.display_name, type: r.referred_type })) };
    }),
  );

// ---------- saved views ----------

export interface SavedView {
  id: string;
  name: string;
  filters: SearchFilters;
  shared: boolean;
  mine: boolean;
}

export const listSavedViews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeamResult<SavedView[]>> =>
    runRead(context, "views.list", null, async (env) => {
      const { data } = await env.caller.from("saved_views").select("id, name, filters, shared, owner").order("name");
      return {
        ok: true,
        data: (data ?? []).map((v) => {
          const parsed = searchFiltersSchema.safeParse(v.filters);
          return { id: v.id, name: v.name, filters: parsed.success ? parsed.data : {}, shared: v.shared, mine: v.owner === env.userId };
        }),
      };
    }),
  );

const saveViewInput = z.object({ name: z.string().trim().min(1).max(80), filters: searchFiltersSchema, shared: z.boolean() });

export const saveView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof saveViewInput>) => saveViewInput.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<{ id: string }>> =>
    runRead(context, "views.save", null, async (env) => {
      // Team views are set by country admins; everyone can keep personal views.
      if (data.shared && env.role !== "tenant_admin") return forbidden();
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row, error } = await (supabaseAdmin as Db)
        .from("saved_views")
        .insert({ tenant_id: env.tenantId, owner: env.userId, name: data.name, filters: asJson(data.filters), shared: data.shared })
        .select("id")
        .single();
      if (error || !row) return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
      return { ok: true, data: { id: row.id } };
    }),
  );

export const deleteView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<{ id: string }>> =>
    runRead(context, "views.delete", null, async (env) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      let q = (supabaseAdmin as Db).from("saved_views").delete().eq("id", data.id).eq("tenant_id", env.tenantId);
      // Admins may remove team views; everyone else only their own.
      if (env.role !== "tenant_admin") q = q.eq("owner", env.userId);
      const { data: rows } = await q.select("id");
      if (!rows || rows.length === 0) return { ok: false, error: seamError("view.notFound", "notFound", "none") };
      return { ok: true, data: { id: data.id } };
    }),
  );

// ---------- bulk jobs ----------

const bulkInput = z
  .object({
    action: z.enum(BULK_ACTIONS),
    to: z.enum(STATUSES as [DocStatus, ...DocStatus[]]).optional(),
    sensitivity: z.enum(SENSITIVITIES).optional(),
    reason: z.string().trim().max(500).optional(),
    ids: z.array(z.string().uuid()).max(BULK_LIMIT).optional(),
    filters: searchFiltersSchema.optional(),
  })
  .refine((v) => Boolean(v.ids?.length) !== Boolean(v.filters), "Send either ids or filters")
  .refine((v) => v.action !== "transition" || Boolean(v.to), "transition needs to")
  .refine((v) => v.action !== "setSensitivity" || Boolean(v.sensitivity), "setSensitivity needs sensitivity")
  .refine((v) => (v.action !== "placeHold" && v.action !== "releaseHold") || Boolean(v.reason), "holds need a reason");

export interface BulkJob {
  id: string;
  action: string;
  total: number;
  done: number;
  changed: number;
  skipped: Record<string, number>;
  status: "queued" | "running" | "done" | "failed";
}

export const startBulkJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof bulkInput>) => bulkInput.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<BulkJob>> =>
    runRead(context, "bulk.start", null, async (env) => {
      if (!can(env.role, "edit")) return forbidden();
      // Resolve ids as the person, so a job can only ever touch documents they can see.
      let ids: string[];
      if (data.filters) {
        const { data: found } = await env.caller.rpc("search_document_ids", { p: asJson(data.filters), p_cap: BULK_LIMIT + 1 });
        ids = found ?? [];
        if (ids.length > BULK_LIMIT) return { ok: false, error: seamError("bulk.tooMany", "validation", "fixInput", String(BULK_LIMIT)) };
      } else {
        const { data: found } = await env.caller.rpc("search_document_ids", { p: {} as Json, p_cap: BULK_LIMIT + 1 });
        const visible = new Set(found ?? []);
        ids = (data.ids ?? []).filter((id) => visible.has(id));
      }
      if (ids.length === 0) return { ok: false, error: seamError("bulk.empty", "validation", "fixInput") };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const params = { ...(data.to ? { to: data.to } : {}), ...(data.sensitivity ? { sensitivity: data.sensitivity } : {}), ...(data.reason ? { reason: data.reason } : {}) };
      const { data: job, error } = await (supabaseAdmin as Db)
        .from("bulk_jobs")
        .insert({ tenant_id: env.tenantId, created_by: env.userId, actor_role: env.role, action: data.action, params, doc_ids: ids, total: ids.length })
        .select("id, action, total, done, changed, skipped, status")
        .single();
      if (error || !job) return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
      // Start the first batch straight away so small jobs finish without waiting for the scheduler.
      const { processBulkJobs } = await import("@/services/bulk-worker");
      await processBulkJobs(supabaseAdmin as Db, job.id);
      const { data: fresh } = await env.caller.from("bulk_jobs").select("id, action, total, done, changed, skipped, status").eq("id", job.id).single();
      return { ok: true, data: (fresh ?? job) as BulkJob };
    }),
  );

export const getBulkJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<BulkJob>> =>
    runRead(context, "bulk.get", null, async (env) => {
      const { data: job } = await env.caller.from("bulk_jobs").select("id, action, total, done, changed, skipped, status").eq("id", data.id).maybeSingle();
      if (!job) return { ok: false, error: seamError("bulk.notFound", "notFound", "none") };
      return { ok: true, data: job as BulkJob };
    }),
  );
