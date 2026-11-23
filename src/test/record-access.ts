// Fixture: gives a person access to every document in the fake database through one record, the
// way most people reach documents. Writes check this (src/services/share-access.ts), so a test
// that is not about access needs it.
import type { FakeDb } from "@/test/fake-db";
export const FIXTURE_RECORD = "rec-fixture";
export function withRecordAccess<T extends FakeDb>(db: T, userId: string): T {
  const relations = db.rows("document_relations");
  for (const d of db.rows("documents")) {
    const id = d["id"];
    if (!relations.some((r) => r["document_id"] === id && r["entity_id"] === FIXTURE_RECORD))
      relations.push({ document_id: id, entity_id: FIXTURE_RECORD, role: "subject" });
  }
  const access = db.rows("entity_access");
  if (!access.some((a) => a["user_id"] === userId && a["entity_id"] === FIXTURE_RECORD))
    access.push({ entity_id: FIXTURE_RECORD, user_id: userId, level: "edit" });
  return db;
}
