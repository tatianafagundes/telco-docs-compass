// Confirming an upload made with the uploadUrl of a registration (file-hooks spec R4.6). Only the
// system that registered the document confirms it; the server reads the stored file, checks its size
// and hash against what was declared, and starts the checks. The upload address cannot replace the
// file afterwards (uploads never overwrite).
import {
  CHANGED,
  loadTarget,
  notCurrent,
  NOT_FOUND,
  type Answer,
} from "@/services/file-result-target";
import { isUuid } from "@/services/file-hook-detail";
import { authenticate } from "@/services/gateway-core";
import { errorReply } from "@/services/gateway-reply";
import { audit, idempotent } from "@/services/gateway-idempotency";
import { processAsSystem } from "@/services/system-processing";
import { tmfError, type TmfError } from "@/services/tmf667-mapper";

const conflict = (code: string, message: string, status = 409): Answer => ({
  status,
  body: tmfError(status, code, status === 413 ? "Payload Too Large" : "Conflict", message),
});
const REFUSED: Record<string, Answer> = {
  "pipeline.notUploaded": conflict(
    "fileMissing",
    "The file is not stored yet. Upload it with uploadUrl first.",
  ),
  "pipeline.hashMismatch": conflict("hashMismatch", "The stored file does not match contentHash."),
  "pipeline.sizeMismatch": conflict("sizeMismatch", "The stored file is not the declared size."),
  "pipeline.tooLarge": conflict("tooLarge", "The stored file is larger than allowed.", 413),
  "pipeline.changed": CHANGED,
};

export async function confirmUpload(
  request: Request,
  id: string,
  versionId: string,
): Promise<Response> {
  const ctx = await authenticate(request, "register");
  if (ctx instanceof Response) return ctx;
  // A malformed id is answered before anything is remembered for its Idempotency-Key (seg L3).
  if (!isUuid(id) || !isUuid(versionId))
    return errorReply(NOT_FOUND.body as TmfError, ctx.requestId);
  return idempotent(request, ctx, `uploaded:${id}:${versionId}`, {}, async () => {
    const t = await loadTarget(ctx, id, versionId);
    if (!t) return NOT_FOUND;
    if (t.doc.registered_by_client !== ctx.clientId)
      return conflict(
        "notRegisteredHere",
        "Only the system that registered this document confirms its upload.",
        403,
      );
    const old = notCurrent(t);
    if (old) return old;
    if (t.doc.pipeline_state !== "uploading")
      return conflict("notUploading", "This file's upload was already confirmed.");
    const r = await processAsSystem(ctx, t.doc.id);
    if (!r.ok)
      return (
        REFUSED[r.error.code] ??
        conflict("cannotProcess", "This file cannot be processed now. Try again shortly.")
      );
    await audit(ctx, "upload", t.doc.id, "Upload confirmed");
    return { status: 200, body: { id: t.doc.id, versionId: t.version.id, state: r.data.state } };
  });
}
