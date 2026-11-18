// Server functions for bulk changes: start a job over the documents a search matches, and read its
// progress. The work itself is done by bulk-worker.ts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import type { DocStatus } from "@/schemas/document";
import { can, seamError, type SeamResult } from "@/services/document-rules";
import { forbidden, runRead, type Db } from "@/services/seam-runtime";
import {
  BULK_ACTIONS,
  bulkStartCapability,
  BULK_LIMIT,
  searchFiltersSchema,
  SENSITIVITIES,
  STATUSES,
} from "@/services/search-rules";
import { asJson } from "@/services/search.functions";
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
  .refine(
    (v) => v.action !== "setSensitivity" || Boolean(v.sensitivity),
    "setSensitivity needs sensitivity",
  )
  .refine(
    (v) => (v.action !== "placeHold" && v.action !== "releaseHold") || Boolean(v.reason),
    "holds need a reason",
  );

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
      if (!can(env.role, bulkStartCapability(data.action, data.to))) return forbidden();
      // Resolve ids as the person, so a job can only ever touch documents they can see.
      let ids: string[];
      if (data.filters) {
        const { data: found } = await env.caller.rpc("search_document_ids", {
          p: asJson(data.filters),
          p_cap: BULK_LIMIT + 1,
        });
        ids = found ?? [];
        if (ids.length > BULK_LIMIT)
          return {
            ok: false,
            error: seamError("bulk.tooMany", "validation", "fixInput", String(BULK_LIMIT)),
          };
      } else {
        const { data: found } = await env.caller.rpc("search_document_ids", {
          p: {} as Json,
          p_cap: BULK_LIMIT + 1,
        });
        const visible = new Set(found ?? []);
        ids = (data.ids ?? []).filter((id) => visible.has(id));
      }
      if (ids.length === 0)
        return { ok: false, error: seamError("bulk.empty", "validation", "fixInput") };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const params = {
        ...(data.to ? { to: data.to } : {}),
        ...(data.sensitivity ? { sensitivity: data.sensitivity } : {}),
        ...(data.reason ? { reason: data.reason } : {}),
      };
      const { data: job, error } = await (supabaseAdmin as Db)
        .from("bulk_jobs")
        .insert({
          tenant_id: env.tenantId,
          created_by: env.userId,
          actor_role: env.role,
          action: data.action,
          params,
          doc_ids: ids,
          total: ids.length,
        })
        .select("id, action, total, done, changed, skipped, status")
        .single();
      if (error || !job)
        return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
      // Start the first batch straight away so small jobs finish without waiting for the scheduler.
      const { processBulkJobs } = await import("@/services/bulk-worker");
      await processBulkJobs(supabaseAdmin as Db, job.id);
      const { data: fresh } = await env.caller
        .from("bulk_jobs")
        .select("id, action, total, done, changed, skipped, status")
        .eq("id", job.id)
        .single();
      return { ok: true, data: (fresh ?? job) as BulkJob };
    }),
  );

export const getBulkJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SeamResult<BulkJob>> =>
    runRead(context, "bulk.get", null, async (env) => {
      const { data: job } = await env.caller
        .from("bulk_jobs")
        .select("id, action, total, done, changed, skipped, status")
        .eq("id", data.id)
        .maybeSingle();
      if (!job) return { ok: false, error: seamError("bulk.notFound", "notFound", "none") };
      return { ok: true, data: job as BulkJob };
    }),
  );
