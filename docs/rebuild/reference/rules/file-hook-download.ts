// File hooks: who may download a version (R2.1, R3.1, D5). Pure: no I/O.
import type { PipelineState } from "@/schemas/document";
import { contentLocked } from "@/services/document-rules";
import { isQuarantined, readDetail } from "@/services/file-hook-rules";

export type Downloader =
  | { kind: "person" }
  | { kind: "readKey" }
  | { kind: "scanner"; clientId: string }
  | { kind: "reader"; clientId: string };
export type DownloadDecision =
  | { ok: true; receipt: boolean }
  | { ok: false; code: "quarantined" | "contentLocked" | "notYourStep" };

/**
 * Who may download a version. A quarantined version: nobody, ever. People and `read` keys keep
 * today's rule (nothing while scanning or quarantined). A scanner or reader only the current version,
 * only during its own external step, and only the system recorded for that step; a scanner's
 * download writes a receipt so a `clean` result can be checked against it (R2.3).
 */
export function downloadDecision(
  who: Downloader,
  doc: { pipelineState: PipelineState; pipelineDetail: unknown; currentVersionId: string | null },
  versionId: string,
): DownloadDecision {
  const d = readDetail(doc.pipelineDetail);
  if (isQuarantined(d, versionId)) return { ok: false, code: "quarantined" };
  const current = doc.currentVersionId?.toLowerCase() === versionId.toLowerCase();
  if (doc.pipelineState === "quarantined" && current) return { ok: false, code: "quarantined" };
  if (who.kind === "person" || who.kind === "readKey")
    return contentLocked(doc.pipelineState)
      ? { ok: false, code: "contentLocked" }
      : { ok: true, receipt: false };
  const want = who.kind === "scanner" ? "scanning" : "reading";
  const mine =
    current &&
    doc.pipelineState === want &&
    d.mode === "external" &&
    d.byClient !== undefined &&
    d.byClient === who.clientId;
  return mine ? { ok: true, receipt: who.kind === "scanner" } : { ok: false, code: "notYourStep" };
}
