// Server functions that only read documents: the list (`find`), the content link and who has
// access. They run as the caller (row-level security) through `runRead`.
import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { contentUrlSchema, docWriteSchema, findSchema } from "@/schemas/document";
import {
  contentLocked,
  DOWNLOAD_URL_SECONDS,
  isSampleStorage,
  PREVIEW_URL_SECONDS,
} from "@/services/document-rules";
import { expireOnRead } from "@/services/expiry-fallback";
import { runRead } from "@/services/seam-runtime";
import {
  BUCKET,
  ContentResult,
  DOC_COLUMNS,
  adminClient,
  fail,
  loadDoc,
} from "@/services/document-write-shared";
// ---------- find (read, RLS) ----------
export const find = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof findSchema>) => findSchema.parse(input))
  .handler(async ({ data, context }) =>
    runRead(context, "find", null, async ({ caller, tenantId }) => {
      // Safety net if the scheduler is not running; the scheduled job is the main path.
      await expireOnRead(adminClient, tenantId);
      const pageSize = data.pageSize ?? 50;
      const offset = data.pageToken ? Number(data.pageToken) : 0;
      const select = `${DOC_COLUMNS}, extraction_fields(status, version_id), document_relations${data.entityId ? "!inner" : ""}(entity_id, role)`;

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
          data: {
            items: res.data ?? [],
            total,
            ...(offset + pageSize < total ? { nextPageToken: String(offset + pageSize) } : {}),
          },
        };
      }
      const res = await base();
      if (res.error) return fail("documents.loadFailed", "unavailable", "retry");
      const total = res.count ?? 0;
      return {
        ok: true,
        data: {
          items: res.data ?? [],
          total,
          ...(offset + pageSize < total ? { nextPageToken: String(offset + pageSize) } : {}),
        },
      };
    }),
  );

// ---------- getContentUrl (read) ----------
export const getContentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof contentUrlSchema>) => contentUrlSchema.parse(input))
  .handler(async ({ data, context }) =>
    runRead<ContentResult>(context, "getContentUrl", data.id, async ({ caller }) => {
      const doc = await loadDoc(caller, data.id);
      if (!doc || !doc.current_version_id) return fail("doc.notFound", "notFound");
      if (contentLocked(doc.pipeline_state))
        return fail("doc.content.locked", "rejected", "none", doc.pipeline_state);
      const { data: v } = await caller
        .from("document_versions")
        .select("id, mime_type, storage_path, sample_pages")
        .eq("id", doc.current_version_id)
        .maybeSingle();
      if (!v) return fail("doc.version.notFound", "notFound");
      if (isSampleStorage(v.storage_path)) {
        const sample: ContentResult = {
          kind: "sample",
          mimeType: v.mime_type,
          pages: v.sample_pages,
          previewable: v.sample_pages !== null,
        };
        return { ok: true, data: sample };
      }
      const seconds = data.purpose === "preview" ? PREVIEW_URL_SECONDS : DOWNLOAD_URL_SECONDS;
      const admin = await adminClient();
      const { data: signed, error } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(
          v.storage_path ?? "",
          seconds,
          data.purpose === "download" ? { download: doc.name } : undefined,
        );
      if (error || !signed) return fail("doc.content.unavailable", "unavailable", "retry");
      const signedOut: ContentResult = {
        kind: "signed",
        url: signed.signedUrl,
        expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
        mimeType: v.mime_type,
        previewable: v.mime_type === "application/pdf" || v.mime_type.startsWith("image/"),
      };
      return { ok: true, data: signedOut };
    }),
  );

// ---------- listAccess (read, RLS) ----------
export const listAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => docWriteSchema.pick({ id: true }).parse(input))
  .handler(async ({ data, context }) =>
    runRead(context, "listAccess", data.id, async ({ caller }) => {
      const { data: visible } = await caller.rpc("can_see_document", { _doc: data.id });
      if (!visible) return fail("doc.notFound", "notFound");
      const [rel, exc, grants, profiles] = await Promise.all([
        caller
          .from("document_relations")
          .select("entity_id, business_entities(referred_type)")
          .eq("document_id", data.id),
        caller
          .from("document_access_exceptions")
          .select("user_id, level, granted_by, expires_at")
          .eq("document_id", data.id),
        caller
          .from("cross_tenant_grants")
          .select("to_tenant, level, granted_by, expires_at, revoked_at")
          .eq("document_id", data.id),
        caller.from("profiles").select("user_id, display_name"),
      ]);
      const name = (id: string | null) =>
        profiles.data?.find((p) => p.user_id === id)?.display_name ?? undefined;
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
            referredType: (rel.data ?? []).find((r) => r.entity_id === a.entity_id)
              ?.business_entities?.referred_type,
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
