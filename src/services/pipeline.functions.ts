// Simulated processing pipeline (prototype) and the usability-test reset.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { seamError } from "@/services/document-rules";
import { advanceStep, SIMULATED_OWNERS } from "@/services/pipeline-step";
import { forbidden, loadRole, runWrite } from "@/services/seam-runtime";
import { adminClient } from "@/services/shared/server-context";

const BUCKET = "documents";

const advanceSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  id: z.string().uuid(),
  /** Restart the step that failed. */
  retry: z.boolean().optional(),
});

/** Moves a newly added document one step: uploading → scanning → reading → ready (or quarantined / failed). */
export const advancePipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof advanceSchema>) => advanceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "advancePipeline", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      (env) =>
        advanceStep(env, data, {
          download: async (path, maxBytes) => {
            const { data: file } = await env.admin.storage.from(BUCKET).download(path);
            if (!file) return null;
            // The download is already buffered here: this only stops a second copy and the hash. Memory
            // is bounded by the bucket's own size limit, which must be at most MAX_PROCESS_BYTES.
            if (file.size > maxBytes) return "tooLarge";
            return new Uint8Array(await file.arrayBuffer());
          },
          now: () => new Date().toISOString(),
          owners: SIMULATED_OWNERS,
        }),
    );
  });
/** Usability-test reset: removes every document people added (seeded rows have no creator) and their files. Group admin only. */
export const resetTestData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await loadRole(context.supabase, context.userId);
    if (r?.role !== "master_admin") return forbidden();
    const admin = await adminClient();
    // Scope: only the caller's own group and its countries, and only synthetic prototype organisations.
    const { data: groupTenants } = await admin
      .from("tenants")
      .select("id")
      .or(`id.eq.${r.tenantId},parent_tenant_id.eq.${r.tenantId}`);
    const tenantIds = (groupTenants ?? []).map((t) => t.id);
    if (!tenantIds.length || tenantIds.some((t) => !t.startsWith("aurora-"))) {
      return { ok: false as const, error: seamError("reset.notTestData", "rejected", "none") };
    }

    // Added = created by a person, or by a connected system (no creator, but not one of the fixed seed ids).
    const { data: added } = await admin
      .from("documents")
      .select("id, created_by")
      .in("tenant_id", tenantIds)
      .is("purged_at", null);
    const ids = (added ?? [])
      .filter((d) => d.created_by !== null || !d.id.startsWith("00000000-0000-0000-0000-"))
      .map((d) => d.id);
    const { data: versions } = ids.length
      ? await admin
          .from("document_versions")
          .select("storage_path")
          .in("document_id", ids)
          .in("tenant_id", tenantIds)
      : { data: [] as { storage_path: string | null }[] };
    const paths = (versions ?? [])
      .map((v) => v.storage_path)
      .filter((p): p is string => Boolean(p) && !String(p).startsWith("sample/"));
    if (paths.length) await admin.storage.from(BUCKET).remove(paths);
    if (ids.length) {
      // The activity log is append-only, so added documents become purged tombstones (same as permanent deletion)
      // and are unlinked from their records; their files are already gone.
      const now = new Date().toISOString();
      const steps = [
        () => admin.from("document_relations").delete().in("document_id", ids),
        () =>
          admin
            .from("documents")
            .update({ deleted_at: now, purged_at: now })
            .in("id", ids)
            .in("tenant_id", tenantIds),
      ];
      for (const step of steps) {
        const { error } = await step();
        if (error) {
          console.error(JSON.stringify({ op: "resetTestData", error: error.message }));
          return { ok: false as const, error: seamError("reset.failed", "unavailable", "retry") };
        }
      }
    }
    await admin.from("idempotency_keys").delete().in("tenant_id", tenantIds);
    const { count: remaining } = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .in("tenant_id", tenantIds)
      .is("purged_at", null);
    return {
      ok: true as const,
      data: {
        documentsRemoved: ids.length,
        filesRemoved: paths.length,
        documentsRemaining: remaining ?? 0,
      },
    };
  });
