// File hooks: the server runs the simulated steps itself when a connected system, not a browser, put
// the file there (API registration, confirmed upload, a result from the organisation's antivirus).
// It stops when a step waits for an outside system or the file is done (R4.5).
import type { SeamResult } from "@/services/document-rules";
import { resolveOwners } from "@/services/external-processing";
import type { SystemCtx } from "@/services/gateway-core";
import { audit } from "@/services/gateway-idempotency";
import {
  advanceStep,
  MAX_PROCESS_BYTES,
  type StepAnswer,
  type StepDeps,
} from "@/services/pipeline-step";
import type { WriteEnv } from "@/services/seam-runtime";

const BUCKET = "documents";
/** uploading → scanning → reading → ready is three steps; one more answers the final state. */
const MAX_STEPS = 4;

/** A connected system acting on its own organisation's document; its activity is recorded as the system. */
function systemEnv(ctx: SystemCtx): WriteEnv {
  return {
    admin: ctx.admin,
    caller: ctx.admin,
    userId: "",
    tenantId: ctx.tenantId,
    role: "contributor",
  };
}
function systemDeps(ctx: SystemCtx): StepDeps {
  return {
    download: async (path, maxBytes) => {
      const { data: file } = await ctx.admin.storage.from(BUCKET).download(path);
      if (!file) return null;
      if (file.size > maxBytes) return "tooLarge";
      return new Uint8Array(await file.arrayBuffer());
    },
    now: () => new Date().toISOString(),
    owners: () => resolveOwners(ctx.admin, ctx.tenantId, new Date()),
    record: (action, documentId, detail) => audit(ctx, action, documentId, detail),
  };
}

/**
 * Moves a document on through its simulated steps until a step waits for an outside system or the
 * document is ready, quarantined or failed. The first refusal is answered as it is (nothing is
 * written for it).
 */
export async function processAsSystem(
  ctx: SystemCtx,
  documentId: string,
): Promise<SeamResult<StepAnswer>> {
  const env = systemEnv(ctx);
  const deps = systemDeps(ctx);
  let last: SeamResult<StepAnswer> | null = null;
  for (let i = 0; i < MAX_STEPS; i++) {
    const r = await advanceStep(env, { id: documentId }, deps);
    if (!r.ok) return last && i > 0 ? last : r;
    last = r;
    if (r.data.waiting || !["uploading", "scanning", "reading"].includes(r.data.state)) return r;
  }
  return last!;
}
