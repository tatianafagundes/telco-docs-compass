// Server functions that give or take away access to one document. Every one goes through `runWrite`.
import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { grantAccessSchema, revokeAccessSchema } from "@/schemas/document";
import { can } from "@/services/document-rules";
import { audit, forbidden, runWrite } from "@/services/seam-runtime";
import { adminClient, fail } from "@/services/document-write-shared";
// ---------- grantAccess / revokeAccess ----------
export const grantAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof grantAccessSchema>) => grantAccessSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "grantAccess", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        if (!can(env.role, "manage")) return forbidden();
        if (data.subject.type === "user") {
          const { data: target } = await env.admin
            .from("user_roles")
            .select("tenant_id")
            .eq("user_id", data.subject.id)
            .maybeSingle();
          if (!target || target.tenant_id !== env.tenantId)
            return fail("access.subject.notFound", "notFound", "fixInput");
          await env.admin.from("document_access_exceptions").upsert({
            document_id: data.id,
            user_id: data.subject.id,
            level: data.level,
            granted_by: env.userId,
            expires_at: data.expiresAt ?? null,
          });
        } else {
          if (data.subject.id === env.tenantId)
            return fail("access.subject.sameTenant", "validation", "fixInput");
          const { data: own } = await env.admin
            .from("tenants")
            .select("cross_tenant_share")
            .eq("id", env.tenantId)
            .maybeSingle();
          if (own?.cross_tenant_share !== "explicitGrant")
            return fail("access.crossTenant.off", "rejected");
          const { data: target } = await env.admin
            .from("tenants")
            .select("id")
            .eq("id", data.subject.id)
            .maybeSingle();
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
        return {
          ok: true,
          data: {
            subject: data.subject,
            level: data.level,
            source: data.subject.type === "user" ? "explicit" : "crossTenantGrant",
          },
        };
      },
    );
  });

export const revokeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof revokeAccessSchema>) => revokeAccessSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "revokeAccess", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        if (!can(env.role, "manage")) return forbidden();
        if (data.subject.type === "user") {
          await env.admin
            .from("document_access_exceptions")
            .delete()
            .eq("document_id", data.id)
            .eq("user_id", data.subject.id);
        } else {
          await env.admin
            .from("cross_tenant_grants")
            .update({ revoked_at: new Date().toISOString() })
            .eq("document_id", data.id)
            .eq("to_tenant", data.subject.id);
        }
        await audit(env, "share", data.id, `revoked ${data.subject.type}`);
        return { ok: true, data: { revoked: true } };
      },
    );
  });
