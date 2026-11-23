// When someone reaches a document only through a share, the share level caps what they may do
// (`shareCappedRole`). Reached through one of their records, or as the organisation's
// administrator, their role applies as it is. Reads use the admin client; errors fail closed.
import type { Db, WriteEnv } from "@/services/seam-runtime";
import { must } from "@/services/shared/must";
import { shareCappedRole, strongestShare, type AppRole } from "@/services/document-rules";
/** The role that applies to each document, in a fixed number of queries (bulk changes use it too). */
export async function rolesForDocuments(
  admin: Db,
  userId: string,
  role: AppRole,
  documentIds: readonly string[],
  now = new Date(),
): Promise<Map<string, AppRole>> {
  const out = new Map(documentIds.map((id) => [id, role]));
  if (role === "tenant_admin" || role === "master_admin" || documentIds.length === 0) return out;
  const ids = [...documentIds];
  const relations =
    must(
      await admin
        .from("document_relations")
        .select("document_id, entity_id")
        .in("document_id", ids),
      "reading the records of documents",
    ) ?? [];
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
  const shares =
    must(
      await admin
        .from("document_access_exceptions")
        .select("document_id, level, expires_at")
        .eq("user_id", userId)
        .in("document_id", ids),
      "reading shares",
    ) ?? [];
  for (const id of ids) {
    if (viaRecord.has(id)) continue;
    const level = strongestShare(
      shares.filter((s) => s.document_id === id),
      now,
    );
    if (level) out.set(id, shareCappedRole(role, level));
  }
  return out;
}
export async function roleForDocument(env: WriteEnv, documentId: string): Promise<AppRole> {
  const roles = await rolesForDocuments(env.admin, env.userId, env.role, [documentId]);
  return roles.get(documentId) ?? env.role;
}
