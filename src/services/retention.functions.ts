import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pageSchema, purgeSchema } from "@/schemas/document";
import { can, seamError, type SeamResult } from "@/services/document-rules";
import { purgeState } from "@/services/document-actions";
import { audit, forbidden, runRead, runWrite, type Db } from "@/services/seam-runtime";

/** Legal holds, retention overview, deletion history and permanent deletion. Manager and above. */

const PAGE = 20;
const DAY = 86_400_000;

async function adminClient(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
const today = () => new Date().toISOString().slice(0, 10);

async function names(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const { data } = await db.from("profiles").select("user_id, display_name").in("user_id", unique);
  return new Map((data ?? []).map((p) => [p.user_id, p.display_name]));
}

export interface HoldRow {
  id: string;
  name: string;
  reference: string | null;
  reason: string | null;
  setBy: string;
  since: string | null;
  versions: number;
  deleted: boolean;
}

/** Active holds in the tenant. Read as the caller, so only documents they can see appear. */
export const listHolds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof pageSchema>) => pageSchema.parse(i))
  .handler(async ({ data, context }): Promise<SeamResult<{ items: HoldRow[]; total: number; pageSize: number }>> =>
    runRead(context, "holds.list", null, async (env) => {
      if (!can(env.role, "manage")) return forbidden();
      const from = data.page * PAGE;
      const { data: rows, count } = await env.caller
        .from("documents")
        .select("id, name, hold_reason, hold_reference, hold_since, hold_set_by, deleted_at, document_versions(count)", { count: "exact" })
        .eq("legal_hold", true)
        .order("hold_since", { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1);
      const who = await names(env.caller, (rows ?? []).map((r) => r.hold_set_by));
      return {
        ok: true,
        data: {
          total: count ?? 0,
          pageSize: PAGE,
          items: (rows ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            reference: r.hold_reference,
            reason: r.hold_reason,
            setBy: (r.hold_set_by && who.get(r.hold_set_by)) || "Set during setup",
            since: r.hold_since,
            versions: (r.document_versions as unknown as { count: number }[])[0]?.count ?? 0,
            deleted: !!r.deleted_at,
          })),
        },
      };
    }),
  );

export interface RetentionRow {
  policyId: string | null;
  documents: number;
}
export interface ExpiryRow {
  id: string;
  name: string;
  retainUntil: string;
}

export const retentionOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeamResult<{ perPolicy: RetentionRow[]; upcoming: ExpiryRow[] }>> =>
    runRead(context, "retention.overview", null, async (env) => {
      if (!can(env.role, "manage")) return forbidden();
      const { data: docs } = await env.caller.from("documents").select("id, name, retention_policy_id, retain_until").is("deleted_at", null);
      const per = new Map<string | null, number>();
      for (const d of docs ?? []) per.set(d.retention_policy_id, (per.get(d.retention_policy_id) ?? 0) + 1);
      const limit = new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10);
      const upcoming = (docs ?? [])
        .filter((d) => d.retain_until && d.retain_until >= today() && d.retain_until <= limit)
        .map((d) => ({ id: d.id, name: d.name, retainUntil: d.retain_until as string }))
        .sort((a, b) => a.retainUntil.localeCompare(b.retainUntil));
      return { ok: true, data: { perPolicy: [...per.entries()].map(([policyId, documents]) => ({ policyId, documents })), upcoming } };
    }),
  );

export interface DeletionRow {
  id: number;
  date: string;
  requestedBy: string;
  documentId: string | null;
  document: string;
  result: "Deleted" | "Restored" | "Deleted permanently";
  restorable: boolean;
}

/**
 * Deletion history for 30 days. Deleted documents are hidden by RLS, so after the role check the
 * service role reads this tenant's delete/restore/purge events and document names only.
 */
export const deletionHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeamResult<DeletionRow[]>> =>
    runRead(context, "deletions.list", null, async (env) => {
      if (!can(env.role, "manage")) return forbidden();
      const admin = await adminClient();
      const since = new Date(Date.now() - 30 * DAY).toISOString();
      const { data: ev } = await admin
        .from("document_events")
        .select("id, document_id, actor, action, detail, created_at")
        .eq("tenant_id", env.tenantId)
        .in("action", ["delete", "restore", "purge"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);
      const ids = [...new Set((ev ?? []).map((e) => e.document_id).filter((x): x is string => !!x))];
      const { data: docs } = ids.length
        ? await admin.from("documents").select("id, name, deleted_at, purged_at").eq("tenant_id", env.tenantId).in("id", ids)
        : { data: [] };
      const byId = new Map((docs ?? []).map((d) => [d.id, d]));
      const who = await names(admin, (ev ?? []).map((e) => e.actor));
      return {
        ok: true,
        data: (ev ?? []).map((e) => {
          const d = e.document_id ? byId.get(e.document_id) : undefined;
          return {
            id: e.id,
            date: e.created_at,
            requestedBy: (e.actor && who.get(e.actor)) || "Someone in your organisation",
            documentId: e.document_id,
            document: d?.name ?? e.detail ?? "Removed document",
            result: e.action === "purge" ? "Deleted permanently" : e.action === "restore" ? "Restored" : "Deleted",
            restorable: e.action === "delete" && !!d?.deleted_at && !d.purged_at,
          };
        }),
      };
    }),
  );

/** "Verify hold" report: every document and version under hold, with content hashes. */
export const verifyHolds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    runRead(context, "holds.verify", null, async (env) => {
      if (!can(env.role, "manage")) return forbidden();
      const { data } = await env.caller
        .from("documents")
        .select("id, name, hold_reference, document_versions(id, label, content_hash, created_at)")
        .eq("legal_hold", true)
        .order("name");
      return {
        ok: true as const,
        data: (data ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          reference: d.hold_reference,
          versions: (d.document_versions ?? []).map((v) => ({ id: v.id, label: v.label, hash: v.content_hash, createdAt: v.created_at })),
        })),
      };
    }),
  );

/** Delete permanently: admins only, never under hold, never before retain_until. */
export const purgeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof purgeSchema>) => purgeSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    // Soft-deleted documents are hidden from the caller, so visibility is checked inside by tenant.
    return runWrite(context, await adminClient(), { op: "purge", idempotencyKey, body, documentId: null }, async (env) => {
      const { data: doc } = await env.admin
        .from("documents")
        .select("id, name, legal_hold, retain_until, tenant_id")
        .eq("id", data.id)
        .eq("tenant_id", env.tenantId)
        .maybeSingle();
      if (!doc) return { ok: false, error: seamError("doc.notFound", "notFound") };
      const state = purgeState(env.role, doc.legal_hold, doc.retain_until, today());
      if (!state.available) {
        const code = doc.legal_hold ? "doc.delete.legalHold" : doc.retain_until ? "doc.delete.retention" : "access.roleTooLow";
        return { ok: false, error: seamError(code, "conflict", "none", state.reason) };
      }
      const { data: versions } = await env.admin.from("document_versions").select("storage_path").eq("document_id", doc.id);
      const paths = (versions ?? []).map((v) => v.storage_path).filter((p): p is string => !!p && !p.startsWith("sample:"));
      if (paths.length) await env.admin.storage.from("documents").remove(paths);
      // Versions and events are append-only by design, so the record stays as a tombstone:
      // stored files and extracted values are removed, access is withdrawn and it can't be restored.
      await env.admin.from("extraction_fields").delete().eq("document_id", doc.id);
      await env.admin.from("document_access_exceptions").delete().eq("document_id", doc.id);
      await env.admin.from("cross_tenant_grants").delete().eq("document_id", doc.id);
      const now = new Date().toISOString();
      await env.admin.from("documents").update({ purged_at: now, deleted_at: now, description: null, characteristic: [] }).eq("id", doc.id);
      await audit(env, "purge", doc.id, null);
      return { ok: true, data: { id: doc.id } };
    });
  });

/** Expiry without a scheduler: documents past expiry_date become Expired when listed or opened. */
export async function expireDue(admin: Db, tenantId: string): Promise<void> {
  const { data } = await admin
    .from("documents")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .lt("expiry_date", today())
    .in("status", ["approved", "effective"])
    .is("deleted_at", null)
    .select("id");
  for (const d of data ?? []) {
    await admin.from("document_events").insert({ tenant_id: tenantId, document_id: d.id, action: "statusChange", detail: "Expired on its expiry date" });
  }
}
