// Server functions for review: send a document back with a problem, and confirm or edit a
// detail read from the file. Every one goes through `runWrite`.
import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { reportProblemSchema, reviewExtractionSchema } from "@/schemas/document";
import { can, isFrozen, contentProtected } from "@/services/document-rules";
import { audit, forbidden, runWrite } from "@/services/seam-runtime";
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
          await env.admin
            .from("documents")
            .update({ status: "draft", updated_at: new Date().toISOString() })
            .eq("id", data.id);
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
      async (env) => {
        if (!can(env.role, "review")) return forbidden();
        const doc = await loadDoc(env.admin, data.id);
        if (!doc) return fail("doc.notFound", "notFound");
        if (isFrozen(doc.status)) return fail("doc.edit.frozen", "rejected");
        if (contentProtected(doc.status)) return fail("doc.edit.approvedContent", "rejected");
        const { data: field } = await env.admin
          .from("extraction_fields")
          .select("id, name, value, original_value")
          .eq("id", data.fieldId)
          .eq("document_id", data.id)
          .maybeSingle();
        if (!field) return fail("extraction.field.notFound", "notFound");
        const now = new Date().toISOString();
        const update =
          data.decision === "accept"
            ? { status: "accepted" as const }
            : data.decision === "reject"
              ? { status: "rejected" as const }
              : {
                  status: "edited" as const,
                  value: data.value as Json,
                  original_value: field.original_value ?? field.value,
                };
        await env.admin
          .from("extraction_fields")
          .update({ ...update, reviewed_by: env.userId, reviewed_at: now })
          .eq("id", data.fieldId);
        // Accepted or edited values become document details; rejected ones are taken off. The audit names the field, never its value.
        const finalValue =
          data.decision === "edit"
            ? (data.value as Json)
            : data.decision === "accept"
              ? field.value
              : null;
        const current = (Array.isArray(doc.characteristic) ? doc.characteristic : []) as {
          name: string;
          value: Json;
        }[];
        const rest = current.filter((c) => c.name !== field.name);
        const characteristic =
          finalValue === null ? rest : [...rest, { name: field.name, value: finalValue }];
        await env.admin
          .from("documents")
          .update({ characteristic: characteristic as Json, updated_at: now })
          .eq("id", data.id);
        const verb =
          data.decision === "accept"
            ? "accepted"
            : data.decision === "edit"
              ? "edited"
              : "rejected";
        await audit(env, "extractionReview", data.id, `Field ${field.name} ${verb}`);
        const { data: updated } = await env.admin
          .from("extraction_fields")
          .select(
            "id, name, value, original_value, confidence, band, source, status, spot_check, reviewed_at",
          )
          .eq("id", data.fieldId)
          .maybeSingle();
        return { ok: true, data: updated };
      },
    );
  });
