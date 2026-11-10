import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/erad/button";
import { ProgressBar } from "@/components/erad/misc";
import { Tag } from "@/components/erad/tag";
import { Tooltip } from "@/components/erad/tooltip";
import { PIPELINE_LABEL, PIPELINE_TONE } from "@/lib/document-labels";
import { batchState, type UploadRow } from "@/hooks/use-upload";
import { batchSummary, middleTruncate, uploadProgress } from "@/services/upload-rules";

export interface UploadProgressProps {
  rows: UploadRow[];
  canDelete: boolean;
  onCancel: (key: string) => void;
  onRetryUpload: (row: UploadRow) => void;
  onRetryReading: (row: UploadRow) => void;
  onKeepUnread: (row: UploadRow) => void;
  onReportSecurity: (row: UploadRow) => void;
  onDelete: (row: UploadRow) => void;
  onShowAttention: () => void;
  onDismiss: () => void;
}

function cause(row: UploadRow): string | null {
  if (row.state === "error") return "Upload stopped. Nothing was added. Try again.";
  if (row.state === "quarantined") return "The security scan found a threat in this file. It was blocked and cannot be opened or downloaded.";
  if (row.state === "failed") {
    return row.retried
      ? "Retrying won't help with this file. Keep it without reading, or delete it and ask for a clearer copy."
      : "We couldn't read the text in this file, so no details were filled in.";
  }
  return null;
}

/** Collapsible per-batch status, bottom right. Only the final state is announced. */
export function UploadProgress(p: UploadProgressProps) {
  const [open, setOpen] = useState(true);
  const states = p.rows.map(batchState);
  const summary = batchSummary(states);
  const live = p.rows.filter((r) => r.state !== "cancelled");
  const progress = uploadProgress(live.map((r) => (r.uploaded || batchState(r) !== "uploading" ? 1 : 0)), summary.done);
  const failedUploads = p.rows.filter((r) => r.state === "error");
  if (p.rows.length === 0) return null;

  return (
    <section aria-label="Adding documents" className="shadow-elev-1 fixed right-4 bottom-4 z-40 flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2 border border-border-item bg-item p-4 text-text-main">
      <div aria-live="polite" className="sr-only">
        {summary.done ? `${summary.line.replace(" added:", " files added.")}.` : ""}
      </div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="type-label-14">{summary.done ? summary.line : `Adding ${live.length} document${live.length === 1 ? "" : "s"}`}</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
          </Button>
          {summary.done ? (
            <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={p.onDismiss}>
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
      {!summary.done ? <ProgressBar value={progress} label={progress >= 99 ? "Uploaded – checking files…" : "Uploading"} /> : null}
      {summary.attention > 1 ? (
        <button type="button" className="focus-ring type-label-12 self-start underline" onClick={p.onShowAttention}>
          {summary.attention} of {live.length} need attention – show them
        </button>
      ) : null}
      {failedUploads.length > 1 ? (
        <Button onClick={() => failedUploads.forEach(p.onRetryUpload)}>Retry {failedUploads.length} failed</Button>
      ) : null}
      {open ? (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {p.rows.map((r) => {
            const why = cause(r);
            const st = r.state === "error" || r.state === "cancelled" ? null : r.state;
            return (
              <li key={r.key} className="flex flex-col gap-1 border-t border-border-subtle pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="type-label-12 min-w-0 truncate" title={r.name}>{middleTruncate(r.name, 36)}</span>
                  {r.state === "cancelled" ? (
                    <span className="type-label-12 text-text-secondary">Cancelled</span>
                  ) : r.state === "error" ? (
                    <Tag tone="major" small>Upload stopped</Tag>
                  ) : st ? (
                    <Tooltip content="Scan is simulated in this prototype.">
                      <span tabIndex={0} className="focus-ring">
                        <Tag tone={PIPELINE_TONE[st]} small>{PIPELINE_LABEL[st]}</Tag>
                      </span>
                    </Tooltip>
                  ) : null}
                </div>
                {why ? <p className="type-label-12 text-text-secondary">{why}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {r.state === "uploading" && !r.uploaded ? <Button onClick={() => p.onCancel(r.key)}>Cancel</Button> : null}
                  {r.state === "error" && failedUploads.length <= 1 ? <Button onClick={() => p.onRetryUpload(r)}>Try again</Button> : null}
                  {r.state === "failed" ? <Button onClick={() => p.onKeepUnread(r)}>Keep without reading</Button> : null}
                  {r.state === "failed" && !r.retried ? <Button onClick={() => p.onRetryReading(r)}>Retry</Button> : null}
                  {r.state === "quarantined" ? <Button onClick={() => p.onReportSecurity(r)}>Report to security</Button> : null}
                  {(r.state === "failed" || r.state === "quarantined") ? (
                    <Button unavailable={!p.canDelete} title={p.canDelete ? undefined : "Ask a manager to delete it"} onClick={() => p.onDelete(r)}>Delete</Button>
                  ) : null}
                </div>
                {(r.state === "failed" || r.state === "quarantined") && !p.canDelete ? (
                  <p className="type-label-12 text-text-secondary">A manager can delete this file.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
