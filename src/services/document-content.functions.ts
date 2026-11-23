// Server functions that add or change what a document holds: register it, edit its details and
// add a version. Every one goes through `runWrite`.
import { typeRefusal } from "@/services/upload-rules";
import { keepUnread } from "@/services/file-hook-versions";
import { updateDocumentIf } from "@/services/document-update";
import { addVersionStep } from "@/services/document-add-version";
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
        // Kept unread only as read: a version added meanwhile is never marked ready unchecked.
        const keep = p.keepUnread
          ? keepUnread(doc.pipeline_state, doc.pipeline_detail, doc.current_version_id)
          : null;
        if (keep && !keep.ok)
          return fail(
            keep.code === "notFailed" ? "doc.keepUnread.notFailed" : "doc.keepUnread.notRead",
            "rejected",
          );
        if (keep?.ok) {
          update.pipeline_state = "ready";
          update.pipeline_detail = keep.detail;
        }
        const written = await updateDocumentIf(
          env.admin,
          { id: data.id, tenantId: env.tenantId, expect: keep?.ok ? { ...keep.expect } : {} },
          update,
          "updating a document's details",
        );
        if (!written) return fail("doc.changedMeanwhile", "conflict", "retry");
        if (keep?.ok)
          await audit(
            env,
            "pipelineStateChange",
            data.id,
            "failed to ready (kept unread)",
            doc.current_version_id,
          );
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
      (env) => addVersionStep(env, body),
    );
  });
