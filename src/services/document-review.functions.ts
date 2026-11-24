// Server functions for review: send a document back with a problem, and confirm or edit a
// detail read from the file. Every one goes through `runWrite`.
import { must } from "@/services/shared/must";
import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { reportProblemSchema, reviewExtractionSchema } from "@/schemas/document";
import { can } from "@/services/document-rules";
import { audit, forbidden, runWrite } from "@/services/seam-runtime";
import { reviewExtractionStep } from "@/services/document-review-step";
import { adminClient, fail, loadDoc } from "@/services/document-write-shared";
// ---------- reportProblem ----------
export const reportProblem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof reportProblemSchema>) => reportProblemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "reportProblem", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        if (data.kind === "sendBack") {
          if (!can(env.role, "review")) return forbidden();
          const doc = await loadDoc(env.admin, data.id);
          if (!doc) return fail("doc.notFound", "notFound");
          if (doc.status !== "in_review") return fail("doc.transition.notAllowed", "rejected");
          must(
            await env.admin
              .from("documents")
              .update({ status: "draft", updated_at: new Date().toISOString() })
              .eq("id", data.id)
              .eq("tenant_id", env.tenantId),
            "writing documents",
          );
          await audit(env, "statusChange", data.id, "in_review to draft (sent back)");
        }
        await audit(env, "report", data.id, `${data.kind}:${data.reason}`);
        return { ok: true, data: { accepted: true } };
      },
    );
  });

// ---------- reviewExtraction ----------
export const reviewExtraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof reviewExtractionSchema>) =>
    reviewExtractionSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "reviewExtraction", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      (env) => reviewExtractionStep(env, data),
    );
  });
