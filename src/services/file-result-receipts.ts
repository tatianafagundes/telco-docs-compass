// File hooks: the record that the organisation's antivirus downloaded a version during an attempt.
// A `clean` answer is accepted only after such a download (file-hooks spec R2.3, design "download
// receipt"). Kept in the activity log: append-only, tied to the document and version.
import type { SystemCtx } from "@/services/gateway-core";
import { cleanLabel } from "@/services/file-hook-text";
import { must } from "@/services/shared/must";

export const SCAN_DOWNLOAD = "scanDownload";
const detailFor = (attempt: number) => `attempt ${attempt}`;

export async function recordScanDownload(
  ctx: SystemCtx,
  documentId: string,
  versionId: string,
  attempt: number,
): Promise<void> {
  must(
    await ctx.admin.from("document_events").insert({
      tenant_id: ctx.tenantId,
      document_id: documentId,
      version_id: versionId,
      actor: null,
      action: SCAN_DOWNLOAD,
      // The attempt first, exact: the check below compares it whole.
      detail: `${detailFor(attempt)} · via ${cleanLabel(ctx.name, 80)}`,
    }),
    "recording a download for a scan",
  );
}

/** Whether this version was downloaded for a scan during this attempt (only its scanner can). */
export async function downloadedForScan(
  ctx: SystemCtx,
  documentId: string,
  versionId: string,
  attempt: number,
): Promise<boolean> {
  const rows = must(
    await ctx.admin
      .from("document_events")
      .select("detail")
      .eq("tenant_id", ctx.tenantId)
      .eq("document_id", documentId)
      .eq("version_id", versionId)
      .eq("action", SCAN_DOWNLOAD)
      .order("created_at", { ascending: false })
      .limit(50),
    "reading the downloads for a scan",
  );
  return (rows ?? []).some((r) => (r.detail ?? "").split(" · ")[0] === detailFor(attempt));
}
