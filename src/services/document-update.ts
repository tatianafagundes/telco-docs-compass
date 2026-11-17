// One checked update of a document row, for writes that must not report success when it failed.
// Filters by id only: the caller has already passed the tenant and visibility checks of `runWrite`.
import { must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";
import type { TablesUpdate } from "@/integrations/supabase/types";

/** @param what short phrase for the step, used in the log if it fails, e.g. "deleting a document". */
export async function updateDocument(
  admin: Db,
  id: string,
  patch: TablesUpdate<"documents">,
  what: string,
): Promise<void> {
  must(await admin.from("documents").update(patch).eq("id", id), what);
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
