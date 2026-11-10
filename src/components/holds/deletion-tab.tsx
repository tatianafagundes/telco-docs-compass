import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/erad/button";
import { DataTable } from "@/components/erad/data-table";
import { EmptyState } from "@/components/erad/empty-state";
import { SkeletonRow } from "@/components/erad/misc";
import { failureText } from "@/hooks/use-config";
import { api } from "@/services/api";

export function DeletionTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["deletions"], queryFn: () => api.deletionHistory() });
  const restore = useMutation({
    mutationFn: (id: string) => api.restoreDeleted({ id }),
    onSuccess: () => { toast.success("Document restored"); void qc.invalidateQueries({ queryKey: ["deletions"] }); void qc.invalidateQueries({ queryKey: ["documents"] }); },
    onError: (e) => toast.error(failureText(e)),
  });
  if (q.isPending) return <table className="w-full"><tbody><SkeletonRow columns={4} /></tbody></table>;
  if (q.isError) return <EmptyState icon={History} title="History didn't load" cause="Something interrupted the connection." action={<Button onClick={() => q.refetch()}>Try again</Button>} />;
  if (q.data.length === 0) return <EmptyState icon={History} title="Nothing deleted in the last 30 days" cause="Deleted documents appear here for 30 days, so you can restore them." />;
  return (
    <div className="overflow-x-auto">
      <DataTable
        caption="Deletion history, last 30 days"
        rows={q.data}
        rowId={(r) => String(r.id)}
        columns={[
          { key: "date", header: "Date", cell: (r) => format(new Date(r.date), "d MMM yyyy, HH:mm") },
          { key: "by", header: "Requested by", cell: (r) => r.requestedBy },
          { key: "doc", header: "Document", cell: (r) => r.document },
          { key: "res", header: "Result", cell: (r) => r.result },
        ]}
        rowActions={(r) => (r.restorable && r.documentId ? <Button onClick={() => restore.mutate(r.documentId as string)}>Restore</Button> : null)}
      />
    </div>
  );
}
