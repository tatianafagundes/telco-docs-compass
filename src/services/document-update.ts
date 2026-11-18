// Checked writes to one document row, for operations that must not report success when the
// write failed or when the row changed under them.
//
// - `updateDocument`: by id and tenant. The caller has also passed the visibility checks of
//   `runWrite`; the tenant filter is a second lock.
// - `updateDocumentIf`: also pins the tenant and the state the caller decided on. Use it when the
//   decision (can this be deleted? is this move allowed?) was made from an earlier read, so a
//   change made in between (a hold placed, a status moved) makes the write do nothing instead of
//   overriding it.
// - `holdColumns`: the columns a legal hold changes, shared by every way of placing or releasing one.
import { must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";
import type { TablesUpdate } from "@/integrations/supabase/types";

/** @param what short phrase for the step, used in the log if it fails, e.g. "deleting a document". */
export async function updateDocument(
  admin: Db,
  where: { id: string; tenantId: string },
  patch: TablesUpdate<"documents">,
  what: string,
): Promise<void> {
  must(
    await admin.from("documents").update(patch).eq("id", where.id).eq("tenant_id", where.tenantId),
    what,
  );
}

/** Columns of the row as the caller read them. A null expects the column to be empty. */
export type Expected = Record<string, string | boolean | null>;

/** @returns true when the row still matched what the caller read and was updated; false when it changed meanwhile. */
export async function updateDocumentIf(
  admin: Db,
  where: { id: string; tenantId: string; expect: Expected },
  patch: TablesUpdate<"documents">,
  what: string,
): Promise<boolean> {
  let q = admin.from("documents").update(patch).eq("id", where.id).eq("tenant_id", where.tenantId);
  for (const [column, value] of Object.entries(where.expect)) {
    // An undefined would silently drop the condition: a missing column is a bug, not "any value".
    if (value === undefined) throw new Error(`updateDocumentIf: no value to expect for ${column}`);
    q = value === null ? q.is(column, null) : q.eq(column, value);
  }
  const rows = must(await q.select("id"), what);
  return (rows?.length ?? 0) > 0;
}

/** The columns a legal hold changes. Placing sets them; releasing clears them. */
export function holdColumns(
  hold: {
    active: boolean;
    reason?: string | null | undefined;
    reference?: string | null | undefined;
  },
  userId: string | null,
  now: string,
) {
  return {
    legal_hold: hold.active,
    hold_reason: hold.active ? (hold.reason ?? null) : null,
    hold_reference: hold.active ? (hold.reference ?? null) : null,
    hold_since: hold.active ? now : null,
    hold_set_by: hold.active ? userId : null,
    updated_at: now,
  };
}
