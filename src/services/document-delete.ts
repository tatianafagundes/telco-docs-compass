// Soft delete of one document, the same for every way in (screens and the TMF API).
//
// Decides with `deleteBlocker` (legal hold, retention date, master floor) and then writes only if
// the document still looks the way it did when it was read. A hold placed between the check and
// the write therefore stops the delete instead of being overridden.
//
// Does not check who may delete (role or scope), does not write the activity log, and does not
// know about HTTP: callers do those.
import { deleteBlocker, seamError, type SeamError } from "@/services/document-rules";
import { updateDocumentIf } from "@/services/document-update";
import { masterRetentionFloor } from "@/services/retention-floor";
import { must } from "@/services/shared/must";
import { tmfError } from "@/services/tmf667-mapper";
import type { Db } from "@/services/seam-runtime";

export interface DeleteTarget {
  id: string;
  legal_hold: boolean;
  hold_reason?: string | null;
  retain_until?: string | null;
  created_at: string;
}

const COLUMNS = "id, legal_hold, hold_reason, retain_until, created_at";

async function blockerFor(admin: Db, tenantId: string, doc: DeleteTarget) {
  return deleteBlocker({
    legalHold: doc.legal_hold,
    holdReason: doc.hold_reason ?? null,
    retainUntil: doc.retain_until ?? null,
    createdAt: doc.created_at,
    minRetentionDays: await masterRetentionFloor(admin, tenantId),
    today: new Date().toISOString().slice(0, 10),
  });
}

/** Throws `DatabaseError` when the database fails, so nothing is deleted on a doubt. */
export async function deleteIfAllowed(
  admin: Db,
  tenantId: string,
  doc: DeleteTarget,
): Promise<SeamError | null> {
  const blocker = await blockerFor(admin, tenantId, doc);
  if (blocker) return blocker;
  const done = await updateDocumentIf(
    admin,
    {
      id: doc.id,
      tenantId,
      expect: { legal_hold: doc.legal_hold, retain_until: doc.retain_until ?? null },
    },
    { deleted_at: new Date().toISOString() },
    "deleting a document",
  );
  if (done) return null;
  // The document changed after it was read: decide again on what it is now.
  const fresh = must(
    await admin
      .from("documents")
      .select(COLUMNS)
      .eq("id", doc.id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    "re-reading a document that changed",
  );
  const again = fresh ? await blockerFor(admin, tenantId, fresh) : null;
  return again ?? seamError("seam.unavailable", "unavailable", "retry");
}

/** What a connected system is told when `deleteIfAllowed` refused: HTTP 409, or 503 when the document was changing. */
export function gatewayRefusal(error: SeamError): { status: number; body: unknown } {
  if (error.code === "seam.unavailable")
    return {
      status: 503,
      body: tmfError(503, "unavailable", "Service Unavailable", "Try again shortly."),
    };
  const held = error.code === "doc.delete.legalHold";
  return {
    status: 409,
    body: tmfError(
      409,
      held ? "legalHold" : "retention",
      "Conflict",
      held
        ? "A legal hold keeps this document safe. Release the hold first."
        : `This document must be kept until ${error.customerFacing?.detail ?? "a later date"}.`,
    ),
  };
}
