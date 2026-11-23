// A reviewer enters a required detail that was never read from the file. The approval gate counts
// only details a person accepted or edited, and an unread detail has no row to accept, so without
// this the approval stays blocked with no way forward.
//
// Order of the writes, chosen so a failure part way is repaired by trying again:
//   1. the document's details, only if the document is still as it was read (status and last change).
//      Two entries at once cannot both pass this: the second finds the row changed and is refused.
//   2. the detail row, unless this person already wrote the same value (a retry after step 3 failed).
//   3. the activity entry. Until it is written the change is not reported as done.
//
// Does not load the document or the document type (the server function does) and does not decide
// when approval may go ahead (`approvalRefusal` does). The database has no unique key on
// (version, detail name), so step 1 is what keeps one row per detail; a unique index is a schema
// change to request from the owner.
import type { Json } from "@/integrations/supabase/types";
import {
  contentProtected,
  isFrozen,
  type SeamResult,
  type SpecCharacteristic,
} from "@/services/document-rules";
import { fail } from "@/services/document-write-shared";
import { updateDocumentIf } from "@/services/document-update";
import { detailsWith } from "@/services/review-rules";
import { audit, type WriteEnv } from "@/services/seam-runtime";
import { must } from "@/services/shared/must";

export interface EnterDetailDoc {
  id: string;
  status: Parameters<typeof isFrozen>[0];
  current_version_id: string | null;
  characteristic: unknown;
  updated_at: string;
}

export async function enterDetail(
  env: WriteEnv,
  doc: EnterDetailDoc,
  spec: SpecCharacteristic[],
  input: { name: string; value: string },
): Promise<SeamResult<{ name: string }>> {
  if (isFrozen(doc.status)) return fail("doc.edit.frozen", "rejected");
  if (contentProtected(doc.status)) return fail("doc.edit.approvedContent", "rejected");
  const versionId = doc.current_version_id;
  if (!versionId) return fail("extraction.detail.noVersion", "rejected");
  // Only a detail the document type requires and a reader could have read: no free-form details here.
  if (!spec.some((c) => c.name === input.name && c.required && c.extractable))
    return fail("extraction.detail.notRequired", "validation", "fixInput");
  const rows = must(
    await env.admin
      .from("extraction_fields")
      .select("id, status, value, reviewed_by")
      .eq("document_id", doc.id)
      .eq("version_id", versionId)
      .eq("name", input.name),
    "reading the details before entering one",
  );
  const existing = rows ?? [];
  // This person already entered the same value and a later step failed: finish the job.
  const ownRetry =
    existing.length === 1 &&
    existing[0]?.status === "edited" &&
    existing[0]?.reviewed_by === env.userId &&
    existing[0]?.value === input.value;
  // Any other row is accepted, edited or rejected in the list, not replaced from here.
  if (existing.length > 0 && !ownRetry)
    return fail("extraction.detail.exists", "conflict", "fixInput");
  const now = new Date().toISOString();
  const updated = await updateDocumentIf(
    env.admin,
    {
      id: doc.id,
      tenantId: env.tenantId,
      expect: { status: doc.status, updated_at: doc.updated_at },
    },
    {
      characteristic: detailsWith(doc.characteristic, input.name, input.value) as Json,
      updated_at: now,
    },
    "writing documents",
  );
  if (!updated) return fail("doc.changedMeanwhile", "conflict", "retry");
  if (!ownRetry)
    must(
      await env.admin.from("extraction_fields").insert({
        version_id: versionId,
        document_id: doc.id,
        tenant_id: env.tenantId,
        name: input.name,
        value: input.value as Json,
        status: "edited",
        spot_check: false,
        reviewed_by: env.userId,
        reviewed_at: now,
      }),
      "writing extraction fields",
    );
  // The activity log names the detail, never its value.
  await audit(env, "extractionReview", doc.id, `Field ${input.name} entered`);
  return { ok: true, data: { name: input.name } };
}
