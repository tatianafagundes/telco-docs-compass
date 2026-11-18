// Stores the first version of a document that has just been registered, from a screen or from the API: the file, the version
// row, the pointer from the document, the links to its records and, when the file is still to
// come, the address to upload it to.
//
// Does not decide whether the request is acceptable (types, sizes, hashes: the caller does),
// and does not write the activity log.
//
// Every step is checked. If one fails, the document is hidden and the file removed, so nothing
// half made stays visible and a retry with a fresh key starts clean.
import { DatabaseError, must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";

export interface FirstVersion {
  documentId: string;
  tenantId: string;
  mimeType: string;
  sizeBytes: number | null;
  contentHash: string;
  /** The file, when it is already in hand; null when the client uploads it afterwards. */
  bytes: Uint8Array<ArrayBuffer> | null;
  related: { id: string; role: string }[];
  /** The person who registered it, when a person did (the API leaves it empty). */
  createdBy?: string;
}

export type StoreOutcome =
  | { ok: true; versionId: string; uploadUrl: string | null; uploadToken: string | null }
  | { ok: false; step: string };

export async function storeFirstVersion(admin: Db, v: FirstVersion): Promise<StoreOutcome> {
  const versionId = crypto.randomUUID();
  const path = `${v.tenantId}/${versionId}`;
  const bucket = admin.storage.from("documents");
  try {
    if (v.bytes)
      must(
        await bucket.upload(path, v.bytes, { contentType: v.mimeType, upsert: false }),
        "storing the file of a new document",
      );
    must(
      await admin.from("document_versions").insert({
        id: versionId,
        document_id: v.documentId,
        tenant_id: v.tenantId,
        label: "1",
        mime_type: v.mimeType,
        size_bytes: v.sizeBytes,
        content_hash: v.contentHash,
        storage_path: path,
        ...(v.createdBy ? { created_by: v.createdBy } : {}),
      }),
      "saving the first version of a new document",
    );
    must(
      await admin
        .from("documents")
        .update({ current_version_id: versionId })
        .eq("id", v.documentId),
      "pointing a new document at its first version",
    );
    must(
      await admin
        .from("document_relations")
        .insert(
          v.related.map((r) => ({ document_id: v.documentId, entity_id: r.id, role: r.role })),
        ),
      "linking a new document to its records",
    );
    const signed = v.bytes
      ? null
      : must(
          await bucket.createSignedUploadUrl(path),
          "preparing the upload address of a new document",
        );
    return {
      ok: true,
      versionId,
      uploadUrl: signed?.signedUrl ?? null,
      uploadToken: signed?.token ?? null,
    };
  } catch (e) {
    // Any failure, including a dropped connection to storage, ends the same way: hide the document
    // and drop the file. A failing cleanup is logged and does not hide the original problem.
    const step =
      e instanceof DatabaseError ? e.message : "unexpected error while storing a new document";
    const cleanup = async (what: string, run: () => PromiseLike<{ error: unknown }>) => {
      try {
        if ((await run()).error) throw new Error("refused");
      } catch {
        console.error(
          JSON.stringify({
            op: "tmf.createDocument.cleanup",
            step: what,
            documentId: v.documentId,
          }),
        );
      }
    };
    await cleanup("hiding the document", () =>
      admin
        .from("documents")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", v.documentId),
    );
    if (v.bytes) await cleanup("removing the file", () => bucket.remove([path]));
    return { ok: false, step };
  }
}
