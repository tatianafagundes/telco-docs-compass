// The role that applies to one document. Reached through one of the person's records, their role
// applies as it is. Reached only through a live share, the share level caps it (`shareCappedRole`).
// Reached neither way, there is no access: null, and the caller refuses as "not found". This
// fails closed when a share expired or was removed after the visibility check, and in bulk
// batches that run later. The organisation's administrator sees every document in it.
// Reads use the admin client; a database error throws (fails closed).
import type { Db, WriteEnv } from "@/services/seam-runtime";
import { must } from "@/services/shared/must";
import { shareCappedRole, strongestShare, type AppRole } from "@/services/document-rules";
/** The role per document, or null where the person has no access left. Three queries at most. */
export async function rolesForDocuments(
  admin: Db,
  userId: string,
  role: AppRole,
  documentIds: readonly string[],
  now = new Date(),
): Promise<Map<string, AppRole | null>> {
  const out = new Map<string, AppRole | null>(documentIds.map((id) => [id, role]));
  if (role === "tenant_admin" || documentIds.length === 0) return out;
  const ids = [...documentIds];
  const [relationsAnswer, sharesAnswer] = await Promise.all([
    admin.from("document_relations").select("document_id, entity_id").in("document_id", ids),
    admin
      .from("document_access_exceptions")
      .select("document_id, level, expires_at")
      .eq("user_id", userId)
      .in("document_id", ids),
  ]);
  const relations = must(relationsAnswer, "reading the records of documents") ?? [];
  const shares = must(sharesAnswer, "reading shares") ?? [];
  const entityIds = [...new Set(relations.map((r) => r.entity_id))];
  const mine = new Set(
    entityIds.length
      ? (
          must(
            await admin
              .from("entity_access")
              .select("entity_id")
              .eq("user_id", userId)
              .in("entity_id", entityIds),
            "reading record access",
          ) ?? []
        ).map((a) => a.entity_id)
      : [],
  );
  const viaRecord = new Set(
    relations.filter((r) => mine.has(r.entity_id)).map((r) => r.document_id),
  );
  for (const id of ids) {
    if (viaRecord.has(id)) continue;
    const level = strongestShare(
      shares.filter((s) => s.document_id === id),
      now,
    );
    out.set(id, level ? shareCappedRole(role, level) : null);
  }
  return out;
}
export async function roleForDocument(env: WriteEnv, documentId: string): Promise<AppRole | null> {
  const roles = await rolesForDocuments(env.admin, env.userId, env.role, [documentId]);
  return roles.get(documentId) ?? null;
}
