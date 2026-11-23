// Server functions that add or change what a document holds: register it, edit its details and
// add a version. Every one goes through `runWrite`.
import { typeRefusal } from "@/services/upload-rules";
import { keepUnread, versionStart } from "@/services/file-hook-versions";
import { updateDocument } from "@/services/document-update";
import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { addVersionSchema, registerSchema, updateMetadataSchema } from "@/schemas/document";
import {
  UPLOAD_URL_SECONDS,
  addDocumentsBlocker,
  can,
  isFrozen,
  contentProtected,
  metadataPatchAllowed,
} from "@/services/document-rules";
import { must } from "@/services/shared/must";
import { storeFirstVersion } from "@/services/document-first-version";
import { audit, forbidden, runWrite } from "@/services/seam-runtime";
import { BUCKET, UploadTicket, adminClient, fail, loadDoc } from "@/services/document-write-shared";
// ---------- register ----------
export const register = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof registerSchema>) => registerSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "register", idempotencyKey, body, scope: { kind: "tenant" } },
      async (env) => {
        const blocked = addDocumentsBlocker(env.role);
        if (blocked) return { ok: false, error: blocked };
        const { data: entity } = await env.caller
          .from("business_entities")
          .select("id, tenant_id")
          .eq("id", data.relatedEntity.id)
          .maybeSingle();
        if (!entity || entity.tenant_id !== env.tenantId)
          return fail("entity.notFound", "notFound");
        const spec = (await env.caller.rpc("effective_specifications")).data?.find(
          (s) => s.code === data.documentType,
        );
        if (!spec) return fail("doc.type.unknown", "validation", "fixInput");
        const def = spec.definition as {
          acceptedMimeTypes?: string[];
          maxSizeMb?: number;
          defaultSensitivity?: string;
          retentionPolicyRef?: string;
        };
        const refusal = typeRefusal(def, data.mimeType, data.size);
        if (refusal === "mimeNotAccepted")
          return fail("doc.type.mimeNotAccepted", "validation", "fixInput");
        if (refusal === "tooLarge") return fail("doc.type.tooLarge", "validation", "fixInput");

        const sensitivity = (data.sensitivity ?? def.defaultSensitivity ?? "internal") as
          "public" | "internal" | "confidential" | "restricted";
        const { data: doc, error } = await env.admin
          .from("documents")
          .insert({
            tenant_id: env.tenantId,
            name: data.name,
            document_type: data.documentType,
            status: "draft",
            pipeline_state: "uploading",
            sensitivity,
            retention_policy_id: def.retentionPolicyRef ?? null,
            characteristic: (data.characteristic ?? []) as Json,
            created_by: env.userId,
          })
          .select("id")
          .single();
        if (error || !doc) return fail("doc.register.failed", "unavailable", "retry");

        const stored = await storeFirstVersion(env.admin, {
          documentId: doc.id,
          tenantId: env.tenantId,
          mimeType: data.mimeType,
          sizeBytes: data.size ?? null,
          contentHash: data.contentHash,
          bytes: null,
          related: [{ id: entity.id, role: data.relatedEntity.role }],
          createdBy: env.userId,
        });
        if (!stored.ok) return fail("doc.register.failed", "unavailable", "retry");
        const versionId = stored.versionId;
        await audit(env, "upload", doc.id, "Version 1", versionId);
        const created = await loadDoc(env.admin, doc.id);
        return {
          ok: true,
          data: {
            document: created,
            upload: {
              versionId,
              method: "signedUrl" as const,
              url: stored.uploadUrl ?? "",
              token: stored.uploadToken ?? "",
              expiresAt: new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString(),
            },
          },
        };
      },
    );
  });

// ---------- updateMetadata ----------
export const updateMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateMetadataSchema>) =>
    updateMetadataSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "updateMetadata", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        if (!can(env.role, "edit")) return forbidden();
        const doc = await loadDoc(env.admin, data.id);
        if (!doc) return fail("doc.notFound", "notFound");
        const p = data.patch;
        const changed: string[] = [];
        if (p.name !== undefined && p.name !== doc.name) changed.push("name");
        if (p.description !== undefined) changed.push("description");
        if (p.sensitivity !== undefined && p.sensitivity !== doc.sensitivity)
          changed.push("sensitivity");
        if (p.expiryDate !== undefined && p.expiryDate !== doc.expiry_date)
          changed.push("expiryDate");
        if (p.characteristic !== undefined) changed.push("characteristic");
        if (p.keepUnread) changed.push("keepUnread");
        const check = metadataPatchAllowed(doc.status, changed);
        if (!check.ok)
          return check.reason === "frozen"
            ? fail("doc.edit.frozen", "rejected")
            : fail("doc.edit.approvedContent", "rejected", "none", check.blocked.join(", "));
        const update: Database["public"]["Tables"]["documents"]["Update"] = {
          updated_at: new Date().toISOString(),
        };
        if (p.name !== undefined) update.name = p.name;
        if (p.description !== undefined) update.description = p.description;
        if (p.sensitivity !== undefined) update.sensitivity = p.sensitivity;
        if (p.expiryDate !== undefined) update.expiry_date = p.expiryDate;
        if (p.characteristic !== undefined) update.characteristic = p.characteristic as Json;
        if (p.keepUnread) {
          const keep = keepUnread(doc.pipeline_state, doc.pipeline_detail);
          if (!keep.ok)
            return fail(
              keep.code === "notFailed" ? "doc.keepUnread.notFailed" : "doc.keepUnread.notRead",
              "rejected",
            );
          update.pipeline_state = "ready";
          update.pipeline_detail = keep.detail;
        }
        const { error } = await env.admin
          .from("documents")
          .update(update)
          .eq("id", data.id)
          .eq("tenant_id", env.tenantId);
        if (error) return fail("doc.update.failed", "unavailable", "retry");
        if (p.keepUnread)
          await audit(env, "pipelineStateChange", data.id, "failed to ready (kept unread)");
        return { ok: true, data: await loadDoc(env.admin, data.id) };
      },
    );
  });

// ---------- addVersion ----------
export const addVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof addVersionSchema>) => addVersionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "addVersion", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        const blocked = addDocumentsBlocker(env.role);
        if (blocked) return { ok: false, error: blocked };
        const doc = await loadDoc(env.admin, data.id);
        if (!doc) return fail("doc.notFound", "notFound");
        if (isFrozen(doc.status)) return fail("doc.edit.frozen", "rejected");
        if (contentProtected(doc.status)) return fail("doc.edit.approvedContent", "rejected");
        // D5: every quarantined version is carried; a quarantined one is never restored.
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
        // A new or restored file is checked again from the start (R4.8), keeping the quarantine list.
        const pointAt = (what: string) =>
          updateDocument(
            env.admin,
            { id: data.id, tenantId: env.tenantId },
            {
              current_version_id: versionId,
              pipeline_state: start.state,
              pipeline_detail: start.detail,
              updated_at: new Date().toISOString(),
            },
            what,
          );

        if (data.restoreFromVersionId) {
          const { data: src } = await env.admin
            .from("document_versions")
            .select("mime_type, size_bytes, content_hash, storage_path, sample_pages, label")
            .eq("id", data.restoreFromVersionId)
            .eq("document_id", data.id)
            .maybeSingle();
          if (!src) return fail("doc.version.notFound", "notFound");
          must(
            await env.admin.from("document_versions").insert({
              id: versionId,
              document_id: data.id,
              tenant_id: env.tenantId,
              label,
              is_named: data.isNamed ?? false,
              note: data.note ?? `Restored from version ${src.label}`,
              mime_type: src.mime_type,
              size_bytes: src.size_bytes,
              content_hash: src.content_hash,
              storage_path: src.storage_path,
              sample_pages: src.sample_pages,
              supersedes: doc.current_version_id,
              created_by: env.userId,
            }),
            "saving a restored version",
          );
          await pointAt("pointing a document at a restored version");
          await audit(
            env,
            "restore",
            data.id,
            `Version ${n} from ${src.label}`.slice(0, 160),
            versionId,
          );
          return {
            ok: true,
            data: { versionId: versionId as string, label, upload: null as UploadTicket | null },
          };
        }

        const storagePath = `${env.tenantId}/${versionId}`;
        must(
          await env.admin.from("document_versions").insert({
            id: versionId,
            document_id: data.id,
            tenant_id: env.tenantId,
            label,
            is_named: data.isNamed ?? false,
            note: data.note ?? null,
            mime_type: data.mimeType,
            size_bytes: data.size ?? null,
            content_hash: data.contentHash ?? "",
            storage_path: storagePath,
            supersedes: doc.current_version_id,
            created_by: env.userId,
          }),
          "saving a new version",
        );
        await pointAt("pointing a document at a new version");
        const signed = must(
          await env.admin.storage.from(BUCKET).createSignedUploadUrl(storagePath),
          "preparing the upload address of a new version",
        );
        await audit(env, "upload", data.id, `Version ${n}`, versionId);
        return {
          ok: true,
          data: {
            versionId: versionId as string,
            label,
            upload: <UploadTicket | null>{
              versionId,
              method: "signedUrl" as const,
              url: signed?.signedUrl ?? "",
              token: signed?.token ?? "",
              expiresAt: new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString(),
            },
          },
        };
      },
    );
  });
