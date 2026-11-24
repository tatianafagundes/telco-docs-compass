// Confirming, correcting or rejecting one detail read from the file (review). The detail must be of
// the document's current version, and the decision is guarded on the status that was read.
import type { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import type { reviewExtractionSchema } from "@/schemas/document";
import { can, contentProtected, isFrozen } from "@/services/document-rules";
import { fail, loadDoc } from "@/services/document-write-shared";
import { detailsWith } from "@/services/review-rules";
import { audit, forbidden, type WriteEnv } from "@/services/seam-runtime";
import { must } from "@/services/shared/must";

export async function reviewExtractionStep(
  env: WriteEnv,
  data: z.output<typeof reviewExtractionSchema>,
) {
  if (!can(env.role, "review")) return forbidden();
  const doc = await loadDoc(env.admin, data.id);
  if (!doc) return fail("doc.notFound", "notFound");
  if (isFrozen(doc.status)) return fail("doc.edit.frozen", "rejected");
  if (contentProtected(doc.status)) return fail("doc.edit.approvedContent", "rejected");
  const { data: field } = await env.admin
    .from("extraction_fields")
    .select("id, name, value, original_value, status, version_id")
    .eq("id", data.fieldId)
    .eq("document_id", data.id)
    .eq("tenant_id", env.tenantId)
    .maybeSingle();
  if (!field) return fail("extraction.field.notFound", "notFound");
  // A detail read from an older version never becomes this version's: it was not read from
  // the file people now see (a reader proposes per version, file-hooks BR-167).
  if (field.version_id !== doc.current_version_id)
    return fail("extraction.field.notCurrent", "rejected");
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
  // Guarded on the status as read: two decisions at once cannot both apply.
  const decided = must(
    await env.admin
      .from("extraction_fields")
      .update({ ...update, reviewed_by: env.userId, reviewed_at: now })
      .eq("id", data.fieldId)
      .eq("tenant_id", env.tenantId)
      .eq("status", field.status)
      .select("id"),
    "writing extraction fields",
  );
  if (!decided?.length) return fail("doc.changedMeanwhile", "conflict", "retry");
  // Accepted or edited values become document details; rejected ones are taken off. The audit names the field, never its value.
  const finalValue =
    data.decision === "edit"
      ? (data.value as Json)
      : data.decision === "accept"
        ? field.value
        : null;
  const characteristic = detailsWith(doc.characteristic, field.name, finalValue);
  must(
    await env.admin
      .from("documents")
      .update({ characteristic: characteristic as Json, updated_at: now })
      .eq("id", data.id)
      .eq("tenant_id", env.tenantId),
    "writing documents",
  );
  const verb =
    data.decision === "accept" ? "accepted" : data.decision === "edit" ? "edited" : "rejected";
  await audit(env, "extractionReview", data.id, `Field ${field.name} ${verb}`);
  const { data: updated } = await env.admin
    .from("extraction_fields")
    .select(
      "id, name, value, original_value, confidence, band, source, status, spot_check, reviewed_at",
    )
    .eq("id", data.fieldId)
    .maybeSingle();
  return { ok: true as const, data: updated };
}
