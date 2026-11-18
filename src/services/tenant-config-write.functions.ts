// Server functions that change a tenant's document type settings: save a specification override
// and reset it to the group's. Tenant admins only. Reading is in tenant-config.functions.ts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { can, seamError } from "@/services/document-rules";
import { audit, forbidden, runWrite } from "@/services/seam-runtime";
import { configChangeBlocker, SPEC_SETTINGS } from "@/services/tenant-rules";
import { adminClient, isAdmin, loadTenant, loadView } from "@/services/tenant-config.functions";
const settingValue = z.union([z.string().max(64), z.boolean()]);
const saveSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  code: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{1,40}$/),
  name: z.string().trim().min(1).max(80).optional(),
  changes: z.record(z.enum(SPEC_SETTINGS), settingValue),
  /** Group only. */
  locked: z.boolean().optional(),
});

function describe(v: Json | undefined): string {
  return v === undefined || v === null ? "unset" : String(v);
}

export const saveSpecification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof saveSchema>) => saveSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "config.saveSpecification", idempotencyKey, body, scope: { kind: "tenant" } },
      async (env) => {
        const view = await loadView(env.caller, env.tenantId);
        if (!view) return { ok: false, error: seamError("tenant.notFound", "notFound") };
        const t = view.tenant;
        const current = view.specs.find((s) => s.code === data.code);
        const fromGroup = (!!current && current.definedIn === "master") || !!current?.overridden;
        const retRef = data.changes.retentionPolicyRef;
        const policy =
          typeof retRef === "string" ? view.retention.find((r) => r.id === retRef) : undefined;
        if (typeof retRef === "string" && !policy)
          return { ok: false, error: seamError("config.unknownPolicy", "validation", "fixInput") };
        if (data.locked !== undefined && !t.isGroup) return forbidden();
        const blocker = configChangeBlocker({
          role: env.role,
          isGroupTenant: t.isGroup,
          specMode: t.inheritance["documentSpecifications"]?.mode,
          locked: !!current?.locked,
          fromGroup,
          changes: data.changes,
          retentionDays: policy?.retainDays ?? null,
          floors: t.floors,
          groupName: t.groupName,
        });
        if (blocker) return { ok: false, error: blocker };

        // Group edits its own row; a country writes its own override (or a new type).
        const { data: own } = await env.admin
          .from("document_specifications")
          .select("id, definition, name")
          .eq("tenant_id", env.tenantId)
          .eq("code", data.code)
          .maybeSingle();
        const before = (own?.definition ?? {}) as { [k: string]: Json | undefined };
        const after = { ...before, ...data.changes };
        if (own) {
          await env.admin
            .from("document_specifications")
            .update({
              definition: after as Json,
              ...(data.name ? { name: data.name } : {}),
              ...(data.locked !== undefined ? { locked: data.locked } : {}),
            })
            .eq("id", own.id);
        } else {
          await env.admin.from("document_specifications").insert({
            id: `spec-${env.tenantId}-${data.code}`.slice(0, 80),
            tenant_id: env.tenantId,
            code: data.code,
            name: data.name ?? current?.name ?? data.code,
            definition: after as Json,
            locked: false,
          });
        }
        const effective = current?.definition ?? {};
        for (const [k, v] of Object.entries(data.changes)) {
          await audit(
            env,
            "configChange",
            null,
            `${data.code}.${k}: ${describe(effective[k])} to ${describe(v)}`,
          );
        }
        if (data.locked !== undefined)
          await audit(env, "configChange", null, `${data.code}.locked: ${data.locked}`);
        return { ok: true, data: { code: data.code } };
      },
    );
  });

const resetSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  code: z.string().min(1).max(64),
});

/** Removes a country's override so the group's version applies again. */
export const resetSpecification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof resetSchema>) => resetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "config.resetSpecification", idempotencyKey, body, scope: { kind: "tenant" } },
      async (env) => {
        if (!isAdmin(env.role)) return forbidden();
        const t = await loadTenant(env.caller, env.tenantId);
        if (!t || t.isGroup) return forbidden();
        const { data: groupRow } = await env.caller
          .from("document_specifications")
          .select("id")
          .eq("tenant_id", t.groupId ?? "")
          .eq("code", data.code)
          .maybeSingle();
        // Only overrides can be reset; a country's own type has no group version.
        if (!groupRow) return { ok: false, error: seamError("config.notOverridden", "validation") };
        await env.admin
          .from("document_specifications")
          .delete()
          .eq("tenant_id", env.tenantId)
          .eq("code", data.code);
        await audit(env, "configChange", null, `${data.code}: reset to group`);
        return { ok: true, data: { code: data.code } };
      },
    );
  });
