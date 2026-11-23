// Adding a version to a document, or restoring an older one as a new version. The file is checked
// again from the start (R4.8) and every quarantined version stays blocked (D5, BR-155).
import type { z } from "zod";
import type { addVersionSchema } from "@/schemas/document";
import {
  UPLOAD_URL_SECONDS,
  addDocumentsBlocker,
  contentProtected,
  isFrozen,
  type SeamResult,
} from "@/services/document-rules";
import { updateDocumentIf } from "@/services/document-update";
import { BUCKET, fail, loadDoc, type UploadTicket } from "@/services/document-write-shared";
import { versionStart } from "@/services/file-hook-versions";
import { audit, type WriteEnv } from "@/services/seam-runtime";
import { must } from "@/services/shared/must";

type AddVersionInput = Omit<z.infer<typeof addVersionSchema>, "idempotencyKey">;
export interface AddedVersion {
  versionId: string;
  label: string;
  upload: UploadTicket | null;
}
const bareHash = (h: string) => h.replace(/^sha256:/i, "").toLowerCase();
/** Same stored object, or same bytes. An empty hash says nothing, so it never matches. */
const sameFile = (a: { content_hash: string; storage_path: string | null }, b: typeof a) =>
  (a.storage_path !== null && a.storage_path === b.storage_path) ||
  (bareHash(a.content_hash) !== "" && bareHash(a.content_hash) === bareHash(b.content_hash));

export async function addVersionStep(
  env: WriteEnv,
  data: AddVersionInput,
): Promise<SeamResult<AddedVersion>> {
  const blocked = addDocumentsBlocker(env.role);
  if (blocked) return { ok: false, error: blocked };
  const doc = await loadDoc(env.admin, data.id);
  if (!doc) return fail("doc.notFound", "notFound");
  if (isFrozen(doc.status)) return fail("doc.edit.frozen", "rejected");
  if (contentProtected(doc.status)) return fail("doc.edit.approvedContent", "rejected");
  const start = versionStart(
    doc.pipeline_state,
    doc.pipeline_detail,
    doc.current_version_id,
    data.restoreFromVersionId,
  );
  if (!start.ok) return fail(`doc.version.${start.code}`, "rejected");
  const { count } = await env.admin
    .from("document_versions")
    .select("id", { count: "exact", head: true })
    .eq("document_id", data.id);
  const n = (count ?? 0) + 1;
  const versionId = crypto.randomUUID();
  const label = data.label ? `${n} · ${data.label}` : String(n);
  let row;
  let restoredLabel = "";
  if (data.restoreFromVersionId) {
    const { data: src } = await env.admin
      .from("document_versions")
      .select("mime_type, size_bytes, content_hash, storage_path, sample_pages, label")
      .eq("id", data.restoreFromVersionId)
      .eq("document_id", data.id)
      .eq("tenant_id", env.tenantId)
      .maybeSingle();
    if (!src) return fail("doc.version.notFound", "notFound");
    // The same file under another version id is the same threat (D5).
    const ids = start.detail.quarantinedVersions;
    if (ids.length) {
      const { data: blockedVersions } = await env.admin
        .from("document_versions")
        .select("content_hash, storage_path")
        .eq("document_id", data.id)
        .in("id", ids);
      if ((blockedVersions ?? []).some((b) => sameFile(b, src)))
        return fail("doc.version.quarantined", "rejected");
    }
    restoredLabel = src.label;
    row = {
      note: data.note ?? `Restored from version ${src.label}`,
      mime_type: src.mime_type,
      size_bytes: src.size_bytes,
      content_hash: src.content_hash,
      storage_path: src.storage_path,
      sample_pages: src.sample_pages,
    };
  } else {
    row = {
      note: data.note ?? null,
      mime_type: data.mimeType,
      size_bytes: data.size ?? null,
      content_hash: data.contentHash ?? "",
      storage_path: `${env.tenantId}/${versionId}`,
    };
  }
  must(
    await env.admin.from("document_versions").insert({
      id: versionId,
      document_id: data.id,
      tenant_id: env.tenantId,
      label,
      is_named: data.isNamed ?? false,
      supersedes: doc.current_version_id,
      created_by: env.userId,
      ...row,
    }),
    "saving a new version",
  );
  // Guarded on what was read: a scan result or another version landing meanwhile is never overwritten.
  // Versions are immutable, so on a conflict the new row stays as an unused, never-current version.
  const pointed = await updateDocumentIf(
    env.admin,
    { id: data.id, tenantId: env.tenantId, expect: { ...start.expect } },
    {
      current_version_id: versionId,
      pipeline_state: start.state,
      pipeline_detail: start.detail,
      updated_at: new Date().toISOString(),
    },
    "pointing a document at a new version",
  );
  if (!pointed) return fail("doc.changedMeanwhile", "conflict", "retry");
  if (data.restoreFromVersionId) {
    await audit(
      env,
      "restore",
      data.id,
      `Version ${n} from ${restoredLabel}`.slice(0, 160),
      versionId,
    );
    return { ok: true, data: { versionId, label, upload: null } };
  }
  const signed = must(
    await env.admin.storage.from(BUCKET).createSignedUploadUrl(row.storage_path ?? ""),
    "preparing the upload address of a new version",
  );
  await audit(env, "upload", data.id, `Version ${n}`, versionId);
  return {
    ok: true,
    data: {
      versionId,
      label,
      upload: {
        versionId,
        method: "signedUrl",
        url: signed?.signedUrl ?? "",
        token: signed?.token ?? "",
        expiresAt: new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString(),
      },
    },
  };
}
