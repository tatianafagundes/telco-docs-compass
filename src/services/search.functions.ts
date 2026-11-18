import { expireOnRead } from "@/services/expiry-fallback";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import { can, seamError, type SeamResult } from "@/services/document-rules";
import { forbidden, runRead, type Db } from "@/services/seam-runtime";
import {
  normaliseFilters,
  PAGE_SIZE,
  searchFiltersSchema,
  splitPage,
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
const pageInput = z.object({
  filters: searchFiltersSchema,
  cursor: cursorSchema.nullable(),
  limit: z.number().int().min(1).max(PAGE_SIZE).optional(),
});

export const asJson = (f: SearchFilters): Json => normaliseFilters(f) as unknown as Json;

export const searchDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof pageInput>) => pageInput.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<SearchPage>> =>
    runRead(context, "search.page", null, async (env) => {
      // Safety net if the scheduler is not running; the scheduled job is the main path.
      await expireOnRead(
        async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as Db,
        env.tenantId,
      );
      const size = data.limit ?? PAGE_SIZE;
      const p = {
        ...normaliseFilters(data.filters),
        limit: size + 1,
        ...(data.cursor ? { cursor: data.cursor } : {}),
      };
      const { data: rows, error } = await env.caller.rpc("search_documents", {
        p: p as unknown as Json,
      });
      if (error) return { ok: false, error: seamError("search.failed", "unavailable", "retry") };
      return {
        ok: true,
        data: splitPage((rows ?? []) as SearchRow[], data.filters.sort ?? "updated", size),
      };
    }),
  );

const filtersInput = z.object({ filters: searchFiltersSchema });

export const countDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof filtersInput>) => filtersInput.parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<number>> =>
    runRead(context, "search.count", null, async (env) => {
      const { data: n, error } = await env.caller.rpc("count_documents", {
        p: asJson(data.filters),
      });
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
      const { data: rows, error } = await env.caller.rpc("facet_documents", {
        p: asJson(data.filters),
      });
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
  .inputValidator((input: { q: string }) =>
    z.object({ q: z.string().trim().min(2).max(64) }).parse(input),
  )
  .handler(
    async ({ data, context }): Promise<SeamResult<{ id: string; name: string; type: string }[]>> =>
      runRead(context, "search.record", null, async (env) => {
        const q = data.q.replace(/[%_\\,()]/g, "");
        const { data: rows } = await env.caller
          .from("business_entities")
          .select("id, display_name, referred_type")
          .or(`id.ilike.${q},display_name.ilike.${q}%`)
          // A stable order, so the same query always lists the same five.
          .order("display_name")
          .limit(5);
        return {
          ok: true,
          data: (rows ?? []).map((r) => ({
            id: r.id,
            name: r.display_name,
            type: r.referred_type,
          })),
        };
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
      const { data } = await env.caller
        .from("saved_views")
        .select("id, name, filters, shared, owner")
        .order("name");
      return {
        ok: true,
        data: (data ?? []).map((v) => {
          const parsed = searchFiltersSchema.safeParse(v.filters);
          return {
            id: v.id,
            name: v.name,
            filters: parsed.success ? parsed.data : {},
            shared: v.shared,
            mine: v.owner === env.userId,
          };
        }),
      };
    }),
  );

const saveViewInput = z.object({
  name: z.string().trim().min(1).max(80),
  filters: searchFiltersSchema,
  shared: z.boolean(),
});

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
        .insert({
          tenant_id: env.tenantId,
          owner: env.userId,
          name: data.name,
          filters: asJson(data.filters),
          shared: data.shared,
        })
        .select("id")
        .single();
      if (error || !row)
        return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
      return { ok: true, data: { id: row.id } };
    }),
  );

export const deleteView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<{ id: string }>> =>
    runRead(context, "views.delete", null, async (env) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      let q = (supabaseAdmin as Db)
        .from("saved_views")
        .delete()
        .eq("id", data.id)
        .eq("tenant_id", env.tenantId);
      // Admins may remove team views; everyone else only their own.
      if (env.role !== "tenant_admin") q = q.eq("owner", env.userId);
      const { data: rows } = await q.select("id");
      if (!rows || rows.length === 0)
        return { ok: false, error: seamError("view.notFound", "notFound", "none") };
      return { ok: true, data: { id: data.id } };
    }),
  );
