// The organisation switch for its own antivirus and reader (file-hooks spec D1, R5.6).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadSwitch, setSwitchStep, type ProcessingSwitch } from "@/services/external-processing";
import type { SeamResult } from "@/services/document-rules";
import { forbidden, runRead, runWrite } from "@/services/seam-runtime";
import { adminClient } from "@/services/shared/server-context";

export const getProcessingSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeamResult<ProcessingSwitch>> =>
    runRead(context, "processing.get", null, async (env) => {
      if (env.role !== "tenant_admin") return forbidden();
      return { ok: true, data: await loadSwitch(await adminClient(), env.tenantId) };
    }),
  );

const setSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(128),
    scan: z.boolean().optional(),
    read: z.boolean().optional(),
  })
  .strict();
export const setProcessingSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof setSchema>) => setSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(),
      { op: "setProcessingSwitch", idempotencyKey, body, scope: { kind: "tenant" } },
      (env) =>
        setSwitchStep(env, {
          ...(body.scan === undefined ? {} : { scan: body.scan }),
          ...(body.read === undefined ? {} : { read: body.read }),
        }),
    );
  });
