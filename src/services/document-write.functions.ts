import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import {
  addVersionSchema,
  contentUrlSchema,
  docWriteSchema,
  findSchema,
  grantAccessSchema,
  registerSchema,
  reportProblemSchema,
  revokeAccessSchema,
  reviewExtractionSchema,
  setHoldSchema,
  transitionSchema,
  updateMetadataSchema,
} from "@/schemas/document";
import {
  can,
  contentLocked,
  deleteBlocker,
  DOWNLOAD_URL_SECONDS,
  isFrozen,
  isSampleStorage,
  isTransitionAllowed,
  pendingRequiredDetails,
  PREVIEW_URL_SECONDS,
  seamError,
  transitionCapability,
  type SeamResult,
  type SpecCharacteristic,
} from "@/services/document-rules";
import { audit, forbidden, runRead, runWrite, type Db } from "@/services/seam-runtime";

const BUCKET = "documents";
const DOC_COLUMNS =
  "id, tenant_id, name, document_type, status, pipeline_state, pipeline_detail, sensitivity, signature_level, effective_date, valid_to, expiry_date, legal_hold, hold_reason, retain_until, characteristic, current_version_id, created_at, updated_at";

async function adminClient(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const today = () => new Date().toISOString().slice(0, 10);
const fail = <T>(code: string, category: Parameters<typeof seamError>[1], next?: Parameters<typeof seamError>[2], detail?: string): SeamResult<T> => ({
  ok: false,
  error: seamError(code, category, next, detail),
});

async function loadDoc(db: Db, id: string) {
  const { data } = await db.from("documents").select(DOC_COLUMNS).eq("id", id).maybeSingle();
  return data;
}

async function specFor(caller: Db, code: string): Promise<SpecCharacteristic[]> {
  const { data } = await caller.rpc("effective_specifications");
  const spec = (data ?? []).find((s) => s.code === code);
  const def = spec?.definition as { specCharacteristic?: SpecCharacteristic[] } | null | undefined;
  return def?.specCharacteristic ?? [];
}

// ---------- find (read, RLS) ----------
export const find = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => findSchema.parse(input))
  .handler(async ({ data, context }) =>
    runRead(context, "find", null, async ({ caller }) => {
      const pageSize = data.pageSize ?? 50;
      const offset = data.pageToken ? Number(data.pageToken) : 0;
      const select = `${DOC_COLUMNS}, document_relations${data.entityId ? "!inner" : ""}(entity_id, role)`;

      const base = () => {
        let q = caller.from("documents").select(select, { count: "exact" }).is("deleted_at", null);
        if (data.entityId) q = q.eq("document_relations.entity_id", data.entityId);
        if (data.documentType?.length) q = q.in("document_type", data.documentType);
        if (data.status?.length) q = q.in("status", data.status);
        if (data.pipelineState?.length) q = q.in("pipeline_state", data.pipelineState);
        return q.order("updated_at", { ascending: false }).range(offset, offset + pageSize - 1);
      };

      const text = data.text?.trim();
      if (text) {
        // Exact contract, quote or order number first.
        const exact = await base().contains("characteristic", JSON.stringify([{ value: text }]));
        if (!exact.error && (exact.data?.length ?? 0) > 0) {
          return { ok: true, data: { items: exact.data ?? [], total: exact.count ?? 0 } };
        }
        const like = text.replace(/[%_,()]/g, " ");
        const res = await base().ilike("name", `%${like}%`);
        if (res.error) return fail("documents.loadFailed", "unavailable", "retry");
        const total = res.count ?? 0;
        return {
          ok: true,
          data: { items: res.data ?? [], total, ...(offset + pageSize < total ? { nextPageToken: String(offset + pageSize) } : {}) },
        };
      }
      const res = await base();
      if (res.error) return fail("documents.loadFailed", "unavailable", "retry");
      const total = res.count ?? 0;
      return {
        ok: true,
        data: { items: res.data ?? [], total, ...(offset + pageSize < total ? { nextPageToken: String(offset + pageSize) } : {}) },
      };
    }),
  );

// ---------- register ----------
export const register = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => registerSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "register", idempotencyKey, body, documentId: null }, async (env) => {
      if (!can(env.role, "edit")) return forbidden();
      const { data: entity } = await env.caller
        .from("business_entities")
        .select("id, tenant_id")
        .eq("id", data.relatedEntity.id)
        .maybeSingle();
      if (!entity || entity.tenant_id !== env.tenantId) return fail("entity.notFound", "notFound");
      const spec = (await env.caller.rpc("effective_specifications")).data?.find((s) => s.code === data.documentType);
      if (!spec) return fail("doc.type.unknown", "validation", "fixInput");
      const def = spec.definition as { acceptedMimeTypes?: string[]; maxSizeMb?: number; defaultSensitivity?: string; retentionPolicyRef?: string };
      if (def.acceptedMimeTypes && !def.acceptedMimeTypes.includes(data.mimeType)) return fail("doc.type.mimeNotAccepted", "validation", "fixInput");
      if (def.maxSizeMb && data.size && data.size > def.maxSizeMb * 1024 * 1024) return fail("doc.type.tooLarge", "validation", "fixInput");

      const sensitivity = (data.sensitivity ?? def.defaultSensitivity ?? "internal") as "public" | "internal" | "confidential" | "restricted";
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

      const versionId = crypto.randomUUID();
      const storagePath = `${env.tenantId}/${versionId}`;
      await env.admin.from("document_versions").insert({
        id: versionId,
        document_id: doc.id,
        tenant_id: env.tenantId,
        label: "1",
        mime_type: data.mimeType,
        size_bytes: data.size ?? null,
        content_hash: data.contentHash,
        storage_path: storagePath,
        created_by: env.userId,
      });
      await env.admin.from("documents").update({ current_version_id: versionId }).eq("id", doc.id);
      await env.admin.from("document_relations").insert({ document_id: doc.id, entity_id: entity.id, role: data.relatedEntity.role });
      const { data: signed } = await env.admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);
      await audit(env, "upload", doc.id, "Version 1", versionId);
      const created = await loadDoc(env.admin, doc.id);
      return {
        ok: true,
        data: {
          document: created,
          upload: {
            versionId,
            method: "signedUrl" as const,
            url: signed?.signedUrl ?? "",
            token: signed?.token ?? "",
            expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
          },
        },
      };
    });
  });

// ---------- updateMetadata ----------
export const updateMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateMetadataSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "updateMetadata", idempotencyKey, body, documentId: data.id }, async (env) => {
      if (!can(env.role, "edit")) return forbidden();
      const doc = await loadDoc(env.admin, data.id);
      if (!doc) return fail("doc.notFound", "notFound");
      if (isFrozen(doc.status)) return fail("doc.edit.frozen", "rejected");
      const p = data.patch;
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (p.name !== undefined) update["name"] = p.name;
      if (p.description !== undefined) update["description"] = p.description;
      if (p.sensitivity !== undefined) update["sensitivity"] = p.sensitivity;
      if (p.expiryDate !== undefined) update["expiry_date"] = p.expiryDate;
      if (p.characteristic !== undefined) update["characteristic"] = p.characteristic;
      if (p.keepUnread) {
        if (doc.pipeline_state !== "failed") return fail("doc.keepUnread.notFailed", "rejected");
        update["pipeline_state"] = "ready";
        update["pipeline_detail"] = { note: "notRead" };
      }
      const { error } = await env.admin.from("documents").update(update).eq("id", data.id);
      if (error) return fail("doc.update.failed", "unavailable", "retry");
      if (p.keepUnread) await audit(env, "pipelineStateChange", data.id, "failed to ready (kept unread)");
      return { ok: true, data: await loadDoc(env.admin, data.id) };
    });
  });

// ---------- addVersion ----------
export const addVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => addVersionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "addVersion", idempotencyKey, body, documentId: data.id }, async (env) => {
      if (!can(env.role, "edit")) return forbidden();
      const doc = await loadDoc(env.admin, data.id);
      if (!doc) return fail("doc.notFound", "notFound");
      if (isFrozen(doc.status)) return fail("doc.edit.frozen", "rejected");
      const { count } = await env.admin
        .from("document_versions")
        .select("id", { count: "exact", head: true })
        .eq("document_id", data.id);
      const n = (count ?? 0) + 1;
      const versionId = crypto.randomUUID();
      const label = data.label ? `${n} · ${data.label}` : String(n);

      if (data.restoreFromVersionId) {
        const { data: src } = await env.admin
          .from("document_versions")
          .select("mime_type, size_bytes, content_hash, storage_path, sample_pages, label")
          .eq("id", data.restoreFromVersionId)
          .eq("document_id", data.id)
          .maybeSingle();
        if (!src) return fail("doc.version.notFound", "notFound");
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
        });
        await env.admin.from("documents").update({ current_version_id: versionId, updated_at: new Date().toISOString() }).eq("id", data.id);
        await audit(env, "restore", data.id, `Version ${n} from ${src.label}`.slice(0, 160), versionId);
        return { ok: true, data: { versionId, label, upload: null } };
      }

      const storagePath = `${env.tenantId}/${versionId}`;
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
      });
      await env.admin
        .from("documents")
        .update({ current_version_id: versionId, pipeline_state: "uploading", pipeline_detail: null, updated_at: new Date().toISOString() })
        .eq("id", data.id);
      const { data: signed } = await env.admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);
      await audit(env, "upload", data.id, `Version ${n}`, versionId);
      return {
        ok: true,
        data: {
          versionId,
          label,
          upload: {
            versionId,
            method: "signedUrl" as const,
            url: signed?.signedUrl ?? "",
            token: signed?.token ?? "",
            expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
          },
        },
      };
    });
  });

// ---------- getContentUrl (read) ----------
export const getContentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contentUrlSchema.parse(input))
  .handler(async ({ data, context }) =>
    runRead(context, "getContentUrl", data.id, async ({ caller }) => {
      const doc = await loadDoc(caller, data.id);
      if (!doc || !doc.current_version_id) return fail("doc.notFound", "notFound");
      if (contentLocked(doc.pipeline_state)) return fail("doc.content.locked", "rejected", "none", doc.pipeline_state);
      const { data: v } = await caller
        .from("document_versions")
        .select("id, mime_type, storage_path, sample_pages")
        .eq("id", doc.current_version_id)
        .maybeSingle();
      if (!v) return fail("doc.version.notFound", "notFound");
      if (isSampleStorage(v.storage_path)) {
        return { ok: true, data: { kind: "sample" as const, mimeType: v.mime_type, pages: v.sample_pages, previewable: v.sample_pages !== null } };
      }
      const seconds = data.purpose === "preview" ? PREVIEW_URL_SECONDS : DOWNLOAD_URL_SECONDS;
      const admin = await adminClient();
      const { data: signed, error } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(v.storage_path ?? "", seconds, data.purpose === "download" ? { download: doc.name } : undefined);
      if (error || !signed) return fail("doc.content.unavailable", "unavailable", "retry");
      return {
        ok: true,
        data: {
          kind: "signed" as const,
          url: signed.signedUrl,
          expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
          mimeType: v.mime_type,
          previewable: v.mime_type === "application/pdf" || v.mime_type.startsWith("image/"),
        },
      };
    }),
  );

// ---------- transition ----------
export const transition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => transitionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "transition", idempotencyKey, body, documentId: data.id }, async (env) => {
      if (!can(env.role, transitionCapability(data.to))) return forbidden();
      const doc = await loadDoc(env.admin, data.id);
      if (!doc) return fail("doc.notFound", "notFound");
      if (!isTransitionAllowed(doc.status, data.to)) return fail("doc.transition.notAllowed", "rejected");
      if (data.to === "approved") {
        const spec = await specFor(env.caller, doc.document_type);
        const { data: fields } = await env.admin
          .from("extraction_fields")
          .select("name, status")
          .eq("document_id", data.id)
          .eq("version_id", doc.current_version_id ?? "");
        const pending = pendingRequiredDetails(spec, fields ?? []);
        if (pending.length > 0) return fail("doc.approve.requiredPending", "rejected", "fixInput", String(pending.length));
      }
      await env.admin.from("documents").update({ status: data.to, updated_at: new Date().toISOString() }).eq("id", data.id);
      await audit(env, "statusChange", data.id, `${doc.status} to ${data.to}`);
      return { ok: true, data: await loadDoc(env.admin, data.id) };
    });
  });

// ---------- setHold ----------
export const setHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setHoldSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "setHold", idempotencyKey, body, documentId: data.id }, async (env) => {
      if (!can(env.role, "manage")) return forbidden();
      await env.admin
        .from("documents")
        .update({
          legal_hold: data.active,
          hold_reason: data.active ? (data.reason ?? null) : null,
          hold_set_by: data.active ? env.userId : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);
      await audit(env, "hold", data.id, data.active ? `Hold set: ${data.reason ?? ""}` : "Hold released");
      return { ok: true, data: await loadDoc(env.admin, data.id) };
    });
  });

// ---------- delete (soft) ----------
export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => docWriteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "delete", idempotencyKey, body, documentId: data.id }, async (env) => {
      if (!can(env.role, "manage")) return forbidden();
      const doc = await loadDoc(env.admin, data.id);
      if (!doc) return fail("doc.notFound", "notFound");
      const { data: tenant } = await env.admin.from("tenants").select("parent_tenant_id").eq("id", env.tenantId).maybeSingle();
      const { data: master } = tenant?.parent_tenant_id
        ? await env.admin.from("tenants").select("hard_floors").eq("id", tenant.parent_tenant_id).maybeSingle()
        : { data: null };
      const floors = (master?.hard_floors ?? {}) as { minRetentionDays?: number };
      const blocker = deleteBlocker({
        legalHold: doc.legal_hold,
        holdReason: doc.hold_reason,
        retainUntil: doc.retain_until,
        createdAt: doc.created_at,
        minRetentionDays: floors.minRetentionDays ?? null,
        today: today(),
      });
      if (blocker) return { ok: false, error: blocker };
      await env.admin.from("documents").update({ deleted_at: new Date().toISOString() }).eq("id", data.id);
      await audit(env, "delete", data.id, null);
      return { ok: true, data: { id: data.id } };
    });
  });

// ---------- restoreDeleted ----------
export const restoreDeleted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => docWriteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    // A deleted row is hidden by RLS, so visibility is checked here: same tenant and entity access.
    return runWrite(context, await adminClient(), { op: "restoreDeleted", idempotencyKey, body, documentId: null }, async (env) => {
      if (!can(env.role, "manage")) return forbidden();
      const { data: doc } = await env.admin.from("documents").select("id, tenant_id, deleted_at").eq("id", data.id).maybeSingle();
      if (!doc || doc.tenant_id !== env.tenantId || !doc.deleted_at) return fail("doc.notFound", "notFound");
      if (env.role !== "tenant_admin") {
        const { data: rel } = await env.admin.from("document_relations").select("entity_id").eq("document_id", data.id);
        const ids = (rel ?? []).map((r) => r.entity_id);
        const { count } = await env.admin
          .from("entity_access")
          .select("entity_id", { count: "exact", head: true })
          .eq("user_id", env.userId)
          .in("entity_id", ids.length ? ids : ["-"]);
        if (!count) return fail("doc.notFound", "notFound");
      }
      await env.admin.from("documents").update({ deleted_at: null }).eq("id", data.id);
      await audit(env, "restore", data.id, "Undeleted");
      return { ok: true, data: { id: data.id } };
    });
  });

// ---------- reportProblem ----------
export const reportProblem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => reportProblemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "reportProblem", idempotencyKey, body, documentId: data.id }, async (env) => {
      if (data.kind === "sendBack") {
        if (!can(env.role, "review")) return forbidden();
        const doc = await loadDoc(env.admin, data.id);
        if (!doc) return fail("doc.notFound", "notFound");
        if (doc.status !== "in_review") return fail("doc.transition.notAllowed", "rejected");
        await env.admin.from("documents").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", data.id);
        await audit(env, "statusChange", data.id, "in_review to draft (sent back)");
      }
      await audit(env, "report", data.id, `${data.kind}:${data.reason}`);
      return { ok: true, data: { accepted: true } };
    });
  });

// ---------- grantAccess / revokeAccess ----------
export const grantAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => grantAccessSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "grantAccess", idempotencyKey, body, documentId: data.id }, async (env) => {
      if (!can(env.role, "manage")) return forbidden();
      if (data.subject.type === "user") {
        const { data: target } = await env.admin.from("user_roles").select("tenant_id").eq("user_id", data.subject.id).maybeSingle();
        if (!target || target.tenant_id !== env.tenantId) return fail("access.subject.notFound", "notFound", "fixInput");
        await env.admin.from("document_access_exceptions").upsert({
          document_id: data.id,
          user_id: data.subject.id,
          level: data.level,
          granted_by: env.userId,
          expires_at: data.expiresAt ?? null,
        });
      } else {
        if (data.subject.id === env.tenantId) return fail("access.subject.sameTenant", "validation", "fixInput");
        const { data: own } = await env.admin.from("tenants").select("cross_tenant_share").eq("id", env.tenantId).maybeSingle();
        if (own?.cross_tenant_share !== "explicitGrant") return fail("access.crossTenant.off", "rejected");
        const { data: target } = await env.admin.from("tenants").select("id").eq("id", data.subject.id).maybeSingle();
        if (!target) return fail("access.subject.notFound", "notFound", "fixInput");
        await env.admin.from("cross_tenant_grants").upsert({
          document_id: data.id,
          to_tenant: data.subject.id,
          level: data.level,
          granted_by: env.userId,
          expires_at: data.expiresAt ?? null,
          revoked_at: null,
        });
      }
      await audit(env, "share", data.id, `granted ${data.level} to ${data.subject.type}`);
      return { ok: true, data: { subject: data.subject, level: data.level, source: data.subject.type === "user" ? "explicit" : "crossTenantGrant" } };
    });
  });

export const revokeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => revokeAccessSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "revokeAccess", idempotencyKey, body, documentId: data.id }, async (env) => {
      if (!can(env.role, "manage")) return forbidden();
      if (data.subject.type === "user") {
        await env.admin.from("document_access_exceptions").delete().eq("document_id", data.id).eq("user_id", data.subject.id);
      } else {
        await env.admin
          .from("cross_tenant_grants")
          .update({ revoked_at: new Date().toISOString() })
          .eq("document_id", data.id)
          .eq("to_tenant", data.subject.id);
      }
      await audit(env, "share", data.id, `revoked ${data.subject.type}`);
      return { ok: true, data: { revoked: true } };
    });
  });

// ---------- listAccess (read, RLS) ----------
export const listAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => docWriteSchema.pick({ id: true }).parse(input))
  .handler(async ({ data, context }) =>
    runRead(context, "listAccess", data.id, async ({ caller }) => {
      const { data: visible } = await caller.rpc("can_see_document", { _doc: data.id });
      if (!visible) return fail("doc.notFound", "notFound");
      const [rel, exc, grants, profiles] = await Promise.all([
        caller.from("document_relations").select("entity_id, business_entities(referred_type)").eq("document_id", data.id),
        caller.from("document_access_exceptions").select("user_id, level, granted_by, expires_at").eq("document_id", data.id),
        caller.from("cross_tenant_grants").select("to_tenant, level, granted_by, expires_at, revoked_at").eq("document_id", data.id),
        caller.from("profiles").select("user_id, display_name"),
      ]);
      const name = (id: string | null) => profiles.data?.find((p) => p.user_id === id)?.display_name ?? undefined;
      const entityIds = (rel.data ?? []).map((r) => r.entity_id);
      const { data: inherited } = await caller
        .from("entity_access")
        .select("entity_id, user_id, level")
        .in("entity_id", entityIds.length ? entityIds : ["-"]);
      const items = [
        ...(inherited ?? []).map((a) => ({
          subject: { type: "user" as const, id: a.user_id, displayName: name(a.user_id) },
          level: a.level,
          source: "inheritedFromEntity" as const,
          viaEntity: {
            id: a.entity_id,
            referredType: (rel.data ?? []).find((r) => r.entity_id === a.entity_id)?.business_entities?.referred_type,
          },
        })),
        ...(exc.data ?? []).map((x) => ({
          subject: { type: "user" as const, id: x.user_id, displayName: name(x.user_id) },
          level: x.level,
          source: "explicit" as const,
          grantedBy: name(x.granted_by),
          expiresAt: x.expires_at ?? undefined,
        })),
        ...(grants.data ?? [])
          .filter((g) => !g.revoked_at)
          .map((g) => ({
            subject: { type: "tenant" as const, id: g.to_tenant },
            level: g.level,
            source: "crossTenantGrant" as const,
            grantedBy: name(g.granted_by),
            expiresAt: g.expires_at ?? undefined,
          })),
      ];
      return { ok: true, data: items };
    }),
  );

// ---------- reviewExtraction ----------
export const reviewExtraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => reviewExtractionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(context, await adminClient(), { op: "reviewExtraction", idempotencyKey, body, documentId: data.id }, async (env) => {
      if (!can(env.role, "review")) return forbidden();
      const doc = await loadDoc(env.admin, data.id);
      if (!doc) return fail("doc.notFound", "notFound");
      if (isFrozen(doc.status)) return fail("doc.edit.frozen", "rejected");
      const { data: field } = await env.admin
        .from("extraction_fields")
        .select("id, value, original_value")
        .eq("id", data.fieldId)
        .eq("document_id", data.id)
        .maybeSingle();
      if (!field) return fail("extraction.field.notFound", "notFound");
      const now = new Date().toISOString();
      const update =
        data.decision === "accept"
          ? { status: "accepted" as const }
          : data.decision === "reject"
            ? { status: "rejected" as const }
            : { status: "edited" as const, value: data.value as Json, original_value: field.original_value ?? field.value };
      await env.admin
        .from("extraction_fields")
        .update({ ...update, reviewed_by: env.userId, reviewed_at: now })
        .eq("id", data.fieldId);
      const { data: updated } = await env.admin
        .from("extraction_fields")
        .select("id, name, value, original_value, confidence, band, source, status, spot_check, reviewed_at")
        .eq("id", data.fieldId)
        .maybeSingle();
      return { ok: true, data: updated };
    });
  });
