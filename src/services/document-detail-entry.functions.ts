// Server function for entering a required detail that was not read. The rules are in
// document-detail-entry.ts; this file only loads the document and its type and goes through `runWrite`.
import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enterDetailSchema } from "@/schemas/document";
import { can } from "@/services/document-rules";
import { enterDetail } from "@/services/document-detail-entry";
import { forbidden, runWrite } from "@/services/seam-runtime";
import { adminClient, fail, loadDoc, specFor } from "@/services/document-write-shared";

export const enterMissingDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof enterDetailSchema>) => enterDetailSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "enterMissingDetail", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        if (!can(env.role, "review")) return forbidden();
        const doc = await loadDoc(env.admin, data.id);
        if (!doc) return fail("doc.notFound", "notFound");
        const spec = await specFor(env.caller, doc.document_type);
        return enterDetail(env, doc, spec, { name: data.name, value: data.value });
      },
    );
  });
