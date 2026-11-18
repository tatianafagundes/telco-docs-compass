// The gate in front of an approval, the same for a person on a screen and a connected system:
// first "is this your own work?", then "are the required details confirmed?". Bulk approval applies
// the same two rules in `bulkSkipReason`, with its details read once per batch.
//
// Does not check the role or scope of the caller, whether the move is allowed (`isTransitionAllowed`)
// or write anything. The caller decides what "own work" means: a person who added the document,
// or a system that registered it or was connected by the person who added it.
import { pendingRequiredDetails, type SpecCharacteristic } from "@/services/document-rules";
import { must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";

export type ApprovalRefusal = { kind: "ownWork" } | { kind: "detailsPending"; count: number };

/**
 * @returns why the approval must wait, or null when it may go ahead. Own work is answered first
 * and without a database read. Throws `DatabaseError` if the details cannot be read, so a failed
 * read is never taken as "nothing pending".
 */
export async function approvalRefusal(
  admin: Db,
  doc: { id: string; current_version_id: string | null },
  spec: SpecCharacteristic[],
  ownWork: boolean,
): Promise<ApprovalRefusal | null> {
  if (ownWork) return { kind: "ownWork" };
  const fields = must(
    await admin
      .from("extraction_fields")
      .select("name, status")
      .eq("document_id", doc.id)
      .eq("version_id", doc.current_version_id ?? ""),
    "reading the details to confirm before an approval",
  );
  const pending = pendingRequiredDetails(spec, fields ?? []);
  return pending.length > 0 ? { kind: "detailsPending", count: pending.length } : null;
}
