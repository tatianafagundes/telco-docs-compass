import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { Dialog } from "@/components/erad/dialog";
import { ProgressBar } from "@/components/erad/misc";
import { Select } from "@/components/erad/select";
import { TextField } from "@/components/erad/text-field";
import { failureText } from "@/hooks/use-config";
import { STATUS_LABEL } from "@/lib/document-labels";
import type { DocStatus } from "@/schemas/document";
import { api } from "@/services/api";
import { can, type AppRole } from "@/services/document-rules";
import { BULK_LIMIT, bulkSummary, SENSITIVITIES, type BulkAction, type SearchFilters, type SkipReason } from "@/services/search-rules";

const ACTION_LABEL: Record<BulkAction, string> = {
  transition: "Move to status",
  setSensitivity: "Change sensitivity",
  placeHold: "Place legal hold",
  releaseHold: "Release legal hold",
};
const TARGETS: DocStatus[] = ["in_review", "approved", "effective", "archived"];

/**
 * Changes many documents at once. Runs as a background job; each document is checked with the
 * same rules as a single change, and anything skipped is counted with its reason.
 */
export function BulkBar(p: { role: AppRole; selectedIds: string[]; matching: { filters: SearchFilters; count: number } | null; onClear: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<BulkAction>("transition");
  const [to, setTo] = useState<DocStatus>("in_review");
  const [sensitivity, setSensitivity] = useState<string>("confidential");
  const [reason, setReason] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const useAll = p.selectedIds.length === 0 && p.matching !== null;
  const n = useAll ? (p.matching?.count ?? 0) : p.selectedIds.length;

  const job = useQuery({
    queryKey: ["bulkJob", jobId],
    queryFn: () => api.getBulkJob(jobId ?? ""),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === "done" || q.state.data.status === "failed") ? false : 2000),
  });

  const start = useMutation({
    mutationFn: () =>
      api.startBulkJob({
        action,
        ...(action === "transition" ? { to } : {}),
        ...(action === "setSensitivity" ? { sensitivity: sensitivity as (typeof SENSITIVITIES)[number] } : {}),
        ...(action === "placeHold" || action === "releaseHold" ? { reason: reason.trim() } : {}),
        ...(useAll ? { filters: p.matching?.filters ?? {} } : { ids: p.selectedIds }),
      }),
    onSuccess: (j) => {
      setOpen(false);
      setJobId(j.id);
      if (j.status === "done") void qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => toast.error(failureText(e)),
  });

  const allowed: BulkAction[] = (["transition", "setSensitivity", "placeHold", "releaseHold"] as BulkAction[]).filter((a) =>
    a === "placeHold" || a === "releaseHold" ? can(p.role, "manage") : can(p.role, "edit"),
  );
  if (allowed.length === 0) return null;

  const tooMany = n > BULK_LIMIT;
  const needsReason = (action === "placeHold" || action === "releaseHold") && reason.trim().length === 0;
  const blocked = tooMany ? `You can change up to ${BULK_LIMIT.toLocaleString("en-GB")} documents at once. Narrow the filters a little.` : needsReason ? "Add a reason for the activity log." : null;
  const j = job.data;
  const finished = j && (j.status === "done" || j.status === "failed");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 rounded-control border border-border-subtle px-3 py-2">
        <span className="type-label-14">
          {useAll ? `All ${n > BULK_LIMIT ? `${BULK_LIMIT.toLocaleString("en-GB")}+` : n.toLocaleString("en-GB")} matching` : `${n.toLocaleString("en-GB")} selected`}
        </span>
        <Button variant="primary" onClick={() => setOpen(true)}>Change…</Button>
        {!useAll ? <Button variant="ghost" onClick={p.onClear}>Clear selection</Button> : null}
      </div>

      {j ? (
        <div className="flex flex-col gap-1" role="status">
          {!finished ? <ProgressBar value={(j.done / Math.max(1, j.total)) * 100} label="Bulk change progress" /> : null}
          <p className="type-paragraph-14">
            {j.status === "failed"
              ? "The change stopped part-way. Everything already changed is in the activity log; you can start it again for the rest."
              : finished
                ? bulkSummary(j.total, j.changed, j.skipped as Partial<Record<SkipReason, number>>)
                : `Working… ${j.done.toLocaleString("en-GB")} of ${j.total.toLocaleString("en-GB")} checked. You can keep working; this carries on in the background.`}
          </p>
          {finished ? (
            <Button
              variant="ghost"
              onClick={() => {
                setJobId(null);
                p.onClear();
                void qc.invalidateQueries({ queryKey: ["documents"] });
              }}
            >
              Done
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Change ${n.toLocaleString("en-GB")} ${n === 1 ? "document" : "documents"}`}
        description="Each document is checked first. Anything that can't change is skipped and counted, and every change is recorded in its activity."
        actions={
          <>
            {blocked ? <span className="type-paragraph-14 text-text-secondary">{blocked}</span> : null}
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" unavailable={blocked !== null || start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? "Starting…" : "Start change"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select label="Change" value={action} onValueChange={(v) => setAction(v as BulkAction)} groups={[{ options: allowed.map((a) => ({ value: a, label: ACTION_LABEL[a] })) }]} />
          {action === "transition" ? (
            <Select label="New status" value={to} onValueChange={(v) => setTo(v as DocStatus)} groups={[{ options: TARGETS.map((s) => ({ value: s, label: STATUS_LABEL[s] })) }]} />
          ) : null}
          {action === "setSensitivity" ? (
            <Select label="Sensitivity" value={sensitivity} onValueChange={setSensitivity} groups={[{ options: SENSITIVITIES.map((s) => ({ value: s, label: s[0]?.toUpperCase() + s.slice(1) })) }]} />
          ) : null}
          {action === "placeHold" || action === "releaseHold" ? (
            <TextField label="Reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} helper="Shown in each document's activity." />
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
