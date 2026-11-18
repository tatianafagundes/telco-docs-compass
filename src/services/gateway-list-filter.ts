// Two filters of GET /document that need more than a column test: documents linked to a record,
// and documents carrying an external identifier.
//
// Does not page or authenticate: `listDocuments` in tmf-gateway.ts does.
import { must } from "@/services/shared/must";
import { tmfError, type ListQuery, type TmfError } from "@/services/tmf667-mapper";
import type { Db } from "@/services/seam-runtime";

/** Most documents a record filter may match. Past this the answer would be incomplete, so it is refused instead. */
export const RELATED_FILTER_MAX = 1000;

/**
 * Ids of the documents linked to the record(s) the query names, only counting records of this
 * tenant; null when the query names none. Never a silent partial list: more than
 * `RELATED_FILTER_MAX` matches answers 400 filterTooBroad.
 */
export async function relatedDocumentIds(
  admin: Db,
  tenantId: string,
  q: Pick<ListQuery, "relatedEntityId" | "referredType">,
): Promise<string[] | null | { error: TmfError }> {
  if (!q.relatedEntityId && !q.referredType) return null;
  let rq = admin
    .from("document_relations")
    .select("document_id, business_entities!inner(id, referred_type, tenant_id)")
    .eq("business_entities.tenant_id", tenantId);
  if (q.relatedEntityId) rq = rq.eq("entity_id", q.relatedEntityId);
  if (q.referredType) rq = rq.eq("business_entities.referred_type", q.referredType);
  const rows = must(await rq.limit(RELATED_FILTER_MAX + 1), "finding the documents of a record");
  const ids = [...new Set((rows ?? []).map((r) => r.document_id))];
  if ((rows?.length ?? 0) <= RELATED_FILTER_MAX) return ids;
  return {
    error: tmfError(
      400,
      "filterTooBroad",
      "Bad Request",
      `More than ${RELATED_FILTER_MAX} documents are linked to this record. Add documentType or lifecycleState to narrow it.`,
    ),
  };
}

/** The JSON to look for in `external_identifier`: the id, and the owner when `externalIdentifier.owner` is given. */
export function externalIdentifierFilter(request: Request, id: string): string {
  const owner = new URL(request.url).searchParams.get("externalIdentifier.owner");
  return JSON.stringify([{ id, ...(owner ? { owner } : {}) }]);
}
