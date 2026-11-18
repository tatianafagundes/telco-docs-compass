// Server functions for the life of a document: status moves, legal hold, delete and restore.
// Every one goes through `runWrite`; the rules themselves are pure functions in document-rules.ts.
import { holdColumns, updateDocument, updateDocumentIf } from "@/services/document-update";
import { deleteIfAllowed } from "@/services/document-delete";
import { isOwnDocument } from "@/services/review-flow-rules";
import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { docWriteSchema, setHoldSchema, transitionSchema } from "@/schemas/document";
import {
  can,
  isTransitionAllowed,
  pendingRequiredDetails,
  transitionCapability,
} from "@/services/document-rules";
import { audit, forbidden, runWrite } from "@/services/seam-runtime";
import { adminClient, fail, loadDoc, specFor } from "@/services/document-write-shared";
// ---------- transition ----------
export const transition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof transitionSchema>) => transitionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "transition", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        if (!can(env.role, transitionCapability(data.to))) return forbidden();
        const doc = await loadDoc(env.admin, data.id);
        if (!doc) return fail("doc.notFound", "notFound");
        if (!isTransitionAllowed(doc.status, data.to))
          return fail("doc.transition.notAllowed", "rejected");
        if (data.to === "approved") {
          // Four-eyes: the person who added a document can't approve it.
          if (isOwnDocument(doc.created_by, env.userId))
            return fail("doc.approve.ownDocument", "rejected");
          const spec = await specFor(env.caller, doc.document_type);
          const { data: fields } = await env.admin
            .from("extraction_fields")
            .select("name, status")
            .eq("document_id", data.id)
            .eq("version_id", doc.current_version_id ?? "");
          const pending = pendingRequiredDetails(spec, fields ?? []);
          if (pending.length > 0)
            return fail(
              "doc.approve.requiredPending",
              "rejected",
              "fixInput",
              String(pending.length),
            );
        }
        const moved = await updateDocumentIf(
          env.admin,
          { id: data.id, tenantId: env.tenantId, expect: { status: doc.status } },
          { status: data.to, updated_at: new Date().toISOString() },
          "changing the status of a document",
        );
        // Someone else moved it first: answer as the refused move it now is.
        if (!moved) return fail("doc.transition.notAllowed", "rejected");
        await audit(env, "statusChange", data.id, `${doc.status} to ${data.to}`);
        return { ok: true, data: await loadDoc(env.admin, data.id) };
      },
    );
  });

// ---------- setHold ----------
export const setHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof setHoldSchema>) => setHoldSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "setHold", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        if (!can(env.role, "manage")) return forbidden();
        const now = new Date().toISOString();
        await updateDocument(
          env.admin,
          data.id,
          holdColumns(data, env.userId, now),
          "changing the legal hold of a document",
        );
        const { count } = await env.admin
          .from("document_versions")
          .select("id", { count: "exact", head: true })
          .eq("document_id", data.id);
        const ref = data.reference ? ` (${data.reference})` : "";
        await audit(
          env,
          "hold",
          data.id,
          data.active
            ? `Hold placed${ref}: ${data.reason ?? ""}`
            : `Hold released: ${data.reason ?? ""}`,
        );
        // metadataOnly: the record and its versions are protected here; the content store itself is not locked.
        return {
          ok: true,
          data: { doc: await loadDoc(env.admin, data.id), versionsCovered: count ?? 0 },
        };
      },
    );
  });

// ---------- delete (soft) ----------
export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof docWriteSchema>) => docWriteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "delete", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        if (!can(env.role, "manage")) return forbidden();
        const doc = await loadDoc(env.admin, data.id);
        if (!doc) return fail("doc.notFound", "notFound");
        const blocker = await deleteIfAllowed(env.admin, env.tenantId, doc);
        if (blocker) return { ok: false, error: blocker };
        await audit(env, "delete", data.id, null);
        return { ok: true, data: { id: data.id } };
      },
    );
  });

// ---------- restoreDeleted ----------
export const restoreDeleted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof docWriteSchema>) => docWriteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    // A deleted row is hidden by RLS, so visibility is checked here: same tenant and entity access.
    return runWrite(
      context,
      await adminClient(),
      { op: "restoreDeleted", idempotencyKey, body, scope: { kind: "tenant" } },
      async (env) => {
        if (!can(env.role, "manage")) return forbidden();
        const { data: doc } = await env.admin
          .from("documents")
          .select("id, tenant_id, deleted_at, purged_at")
          .eq("id", data.id)
          .maybeSingle();
        if (!doc || doc.tenant_id !== env.tenantId || !doc.deleted_at || doc.purged_at)
          return fail("doc.notFound", "notFound");
        if (env.role !== "tenant_admin") {
          const { data: rel } = await env.admin
            .from("document_relations")
            .select("entity_id")
            .eq("document_id", data.id);
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
      },
    );
  });
