// Simulated processing pipeline (prototype) and the usability-test reset.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { seamError, type SeamErr } from "@/services/document-rules";
import { audit, forbidden, loadRole, runWrite, type Db } from "@/services/seam-runtime";
import { nextPipelineState, simulatedOutcome } from "@/services/upload-rules";
import type { PipelineState } from "@/schemas/document";

const BUCKET = "documents";

async function adminClient(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const fail = (code: string): SeamErr => ({ ok: false, error: seamError(code, "rejected", "none") });

const advanceSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  id: z.string().uuid(),
  /** Retry reading once after it failed. */
  retry: z.boolean().optional(),
});

/** Moves a newly added document one step: uploading → scanning → reading → ready (or quarantined / failed). */
export const advancePipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof advanceSchema>) => advanceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "advancePipeline", idempotencyKey, body, documentId: data.id }, async (env) => {
      const { data: doc } = await env.admin
        .from("documents")
        .select("id, name, pipeline_state, pipeline_detail, current_version_id, created_by")
        .eq("id", data.id)
        .maybeSingle();
      if (!doc) return { ok: false, error: seamError("doc.notFound", "notFound") };
      // Seeded documents never change state on their own.
      if (!doc.created_by) return fail("pipeline.seeded");
      let current = doc.pipeline_state as PipelineState;
      if (data.retry) {
        if (current !== "failed") return fail("pipeline.retry.notFailed");
        current = "reading";
      }
      const { data: version } = await env.admin
        .from("document_versions")
        .select("storage_path")
        .eq("id", doc.current_version_id ?? "")
        .maybeSingle();
      let text = "";
      if (current === "uploading") {
        // The file must be in storage before checking starts.
        const { data: file } = version?.storage_path ? await env.admin.storage.from(BUCKET).download(version.storage_path) : { data: null };
        if (!file) return { ok: false, error: seamError("pipeline.notUploaded", "unavailable", "retry") };
      } else if (current === "scanning" || current === "reading") {
        const { data: file } = version?.storage_path ? await env.admin.storage.from(BUCKET).download(version.storage_path) : { data: null };
        text = file ? new TextDecoder("latin1").decode(await file.arrayBuffer()) : "";
      }
      const next = nextPipelineState(current, simulatedOutcome(doc.name, text));
      const detail = next === "failed" ? { reason: data.retry ? "unreadableAgain" : "unreadable" } : next === "quarantined" ? { reason: "threat" } : null;
      await env.admin
        .from("documents")
        .update({ pipeline_state: next, pipeline_detail: detail, updated_at: new Date().toISOString() })
        .eq("id", data.id);
      await audit(env, "pipelineStateChange", data.id, `${current} to ${next}`);
      return { ok: true, data: { id: data.id, state: next, retried: Boolean(data.retry) } };
    });
  });

/** Usability-test reset: removes every document people added (seeded rows have no creator) and their files. Group admin only. */
export const resetTestData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await loadRole(context.supabase, context.userId);
    if (r?.role !== "master_admin") return forbidden();
    const admin = await adminClient();
    // Guard: only ever run against the synthetic prototype data.
    const { count: synthetic } = await admin.from("tenants").select("id", { count: "exact", head: true }).like("id", "aurora-%");
    if (!synthetic) return { ok: false as const, error: seamError("reset.notTestData", "rejected", "none") };

    const { data: added } = await admin.from("documents").select("id").not("created_by", "is", null);
    const ids = (added ?? []).map((d) => d.id);
    const { data: versions } = ids.length
      ? await admin.from("document_versions").select("storage_path").in("document_id", ids)
      : { data: [] as { storage_path: string | null }[] };
    const paths = (versions ?? []).map((v) => v.storage_path).filter((p): p is string => Boolean(p) && !String(p).startsWith("sample/"));
    if (paths.length) await admin.storage.from(BUCKET).remove(paths);
    if (ids.length) {
      // Break the document ↔ current version link first so both can go.
      const steps = [
        () => admin.from("documents").update({ current_version_id: null }).in("id", ids),
        () => admin.from("document_events").delete().in("document_id", ids),
        () => admin.from("document_versions").delete().in("document_id", ids),
        () => admin.from("documents").delete().in("id", ids),
      ];
      for (const step of steps) {
        const { error } = await step();
        if (error) {
          console.error(JSON.stringify({ op: "resetTestData", error: error.message }));
          return { ok: false as const, error: seamError("reset.failed", "unavailable", "retry") };
        }
      }
    }
    await admin.from("idempotency_keys").delete().neq("key", "");
    const { count: remaining } = await admin.from("documents").select("id", { count: "exact", head: true });
    return { ok: true as const, data: { documentsRemoved: ids.length, filesRemoved: paths.length, documentsRemaining: remaining ?? 0 } };
  });
