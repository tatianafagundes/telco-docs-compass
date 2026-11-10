import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { DataTable } from "@/components/erad/data-table";
import { Dialog } from "@/components/erad/dialog";
import { EmptyState } from "@/components/erad/empty-state";
import { SkeletonRow } from "@/components/erad/misc";
import { Tag } from "@/components/erad/tag";
import { TextField } from "@/components/erad/text-field";
import { failureText } from "@/hooks/use-config";
import { api } from "@/services/api";
import type { HoldRow } from "@/services/retention.functions";

export function HoldsTab() {
  const [page, setPage] = useState(0);
  const [release, setRelease] = useState<HoldRow | null>(null);
  const [reason, setReason] = useState("");
  const [report, setReport] = useState(false);
  const qc = useQueryClient();
  const holds = useQuery({ queryKey: ["holds", page], queryFn: () => api.listHolds(page) });
  const verify = useQuery({ queryKey: ["holds", "verify"], queryFn: () => api.verifyHolds(), enabled: report });
  const doRelease = useMutation({
    mutationFn: (v: { id: string; reason: string }) => api.setHold({ id: v.id, active: false, reason: v.reason }),
    onSuccess: () => { toast.success("Legal hold released"); setRelease(null); setReason(""); void qc.invalidateQueries({ queryKey: ["holds"] }); },
    onError: (e) => toast.error(failureText(e)),
  });

  if (holds.isPending) return <table className="w-full"><tbody><SkeletonRow columns={6} /><SkeletonRow columns={6} /></tbody></table>;
  if (holds.isError) {
    return <EmptyState icon={Lock} title="Holds didn't load" cause="Something interrupted the connection." action={<Button onClick={() => holds.refetch()}>Try again</Button>} />;
  }
  const { items, total, pageSize } = holds.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setReport(true)}><ShieldCheck aria-hidden="true" /> Verify hold</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Lock} title="No documents are on hold" cause="When a manager places a legal hold, it appears here with its reason." />
      ) : (
        <div className="overflow-x-auto">
          <DataTable
            caption="Active legal holds"
            rows={items}
            rowId={(r) => r.id}
            columns={[
              { key: "name", header: "Document", cell: (r) => <span className="inline-flex items-center gap-2"><Lock aria-hidden="true" className="size-4" />{r.name}{r.deleted ? <Tag small>Deleted</Tag> : null}</span> },
              { key: "ref", header: "Reference", cell: (r) => r.reference ?? "None" },
              { key: "reason", header: "Reason", cell: (r) => r.reason ?? "None given" },
              { key: "by", header: "Set by", cell: (r) => r.setBy },
              { key: "since", header: "Since", cell: (r) => (r.since ? format(new Date(r.since), "d MMM yyyy") : "Before tracking") },
              { key: "v", header: "Versions covered", cell: (r) => r.versions },
            ]}
            rowActions={(r) => <Button onClick={() => setRelease(r)}>Release</Button>}
          />
        </div>
      )}
      {total > pageSize ? (
        <div className="flex items-center justify-end gap-2">
          <span className="type-label-14 text-text-secondary">{`${page * pageSize + 1}–${Math.min(total, (page + 1) * pageSize)} of ${total}`}</span>
          <Button unavailable={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button unavailable={(page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      ) : null}
      <Dialog
        open={!!release}
        onOpenChange={(o) => { if (!o) setRelease(null); }}
        title="Release legal hold"
        description="After release, the document follows its normal retention again and can be deleted once its keep-until date has passed."
        actions={
          <>
            <Button onClick={() => setRelease(null)}>Cancel</Button>
            <Button variant="primary" unavailable={!reason.trim()} onClick={() => release && doRelease.mutate({ id: release.id, reason: reason.trim() })}>Release hold</Button>
          </>
        }
      >
        <TextField label="Reason for release" value={reason} onChange={(e) => setReason(e.target.value)} helper="Required, so the history explains why." />
      </Dialog>
      <Dialog open={report} onOpenChange={setReport} title="Hold verification" description="Every document and version currently under legal hold.">
        <div className="max-h-[360px] overflow-auto">
          {verify.isPending ? <p className="type-paragraph-14">Checking holds…</p> : null}
          {verify.data?.length === 0 ? <p className="type-paragraph-14">No documents are on hold.</p> : null}
          <ul className="flex flex-col gap-2">
            {verify.data?.map((d) => (
              <li key={d.id} className="type-label-14">
                <span className="type-label-14-medium">{d.name}</span>{d.reference ? ` · ${d.reference}` : ""}
                <ul className="pl-4 text-text-secondary">
                  {d.versions.map((v) => <li key={v.id}>{`${v.label} · ${v.hash.slice(0, 12)}`}</li>)}
                </ul>
              </li>
            ))}
          </ul>
          {verify.data?.length ? <p className="type-label-12 mt-2 text-text-secondary">The content store is not locked in this prototype.</p> : null}
        </div>
      </Dialog>
    </div>
  );
}
