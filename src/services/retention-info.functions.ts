// Retention explanation for one document (Details tab), read as the caller.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { seamError, type SeamResult } from "@/services/document-rules";
import { runRead } from "@/services/seam-runtime";
export interface RetentionInfo {
  policyName: string | null;
  keepUntil: string | null;
  why: string | null;
}

/** Retention explanation for the Details tab, read as the caller. */
export const retentionFor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<SeamResult<RetentionInfo>> =>
    runRead(context, "retention.for", data.id, async (env) => {
      const { data: doc } = await env.caller
        .from("documents")
        .select("retention_policy_id, retain_until")
        .eq("id", data.id)
        .maybeSingle();
      if (!doc) return { ok: false, error: seamError("doc.notFound", "notFound") };
      if (!doc.retention_policy_id)
        return { ok: true, data: { policyName: null, keepUntil: doc.retain_until, why: null } };
      const { data: p } = await env.caller
        .from("retention_policies")
        .select("name, retain_days, locked, tenant_id")
        .eq("id", doc.retention_policy_id)
        .maybeSingle();
      const { data: owner } = p
        ? await env.caller
            .from("tenants")
            .select("display_name")
            .eq("id", p.tenant_id)
            .maybeSingle()
        : { data: null };
      const years = p ? Math.round(p.retain_days / 365) : null;
      const why = p
        ? `${years} years, set by ${owner?.display_name ?? "your organisation"}${p.locked ? ", locked" : ""}`
        : null;
      return { ok: true, data: { policyName: p?.name ?? null, keepUntil: doc.retain_until, why } };
    }),
  );
