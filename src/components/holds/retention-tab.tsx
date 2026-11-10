import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Archive } from "lucide-react";
import { Button } from "@/components/erad/button";
import { DataTable } from "@/components/erad/data-table";
import { EmptyState } from "@/components/erad/empty-state";
import { SkeletonRow } from "@/components/erad/misc";
import { Tag } from "@/components/erad/tag";
import { configQuery } from "@/hooks/use-config";
import { api } from "@/services/api";
import { effectiveRetentionDays, yearsLabel } from "@/services/tenant-rules";

export function RetentionTab() {
  const config = useQuery(configQuery);
  const overview = useQuery({ queryKey: ["retention", "overview"], queryFn: () => api.retentionOverview() });
  if (config.isPending || overview.isPending) return <table className="w-full"><tbody><SkeletonRow columns={4} /></tbody></table>;
  if (config.isError || overview.isError) {
    return <EmptyState icon={Archive} title="Retention didn't load" cause="Something interrupted the connection." action={<Button onClick={() => { void config.refetch(); void overview.refetch(); }}>Try again</Button>} />;
  }
  const { tenant, retention } = config.data;
  const counts = new Map(overview.data.perPolicy.map((p) => [p.policyId, p.documents]));
  const upcoming = overview.data.upcoming;
  return (
    <div className="flex flex-col gap-4">
      <p className="type-paragraph-14 text-text-secondary">
        Retention periods here are demo values. Real periods need legal input for each country and document type.
      </p>
      <div className="overflow-x-auto">
        <DataTable
          caption="Retention policies in force"
          rows={retention}
          rowId={(r) => r.id}
          columns={[
            { key: "name", header: "Policy", cell: (r) => r.name },
            {
              key: "src",
              header: "Where defined",
              cell: (r) => (
                <Tag tone={r.locked ? "indeterminate" : r.tenantId === tenant.id ? "purple" : "cleared"}>
                  {tenant.isGroup ? "Set here" : r.locked ? `Locked by ${tenant.groupName}` : r.tenantId === tenant.id ? "Changed here" : `From ${tenant.groupName}`}
                </Tag>
              ),
            },
            {
              key: "keep",
              header: "Keep for",
              cell: (r) => {
                const eff = effectiveRetentionDays(r.retainDays, tenant.floors);
                return eff.raised ? `Raised to ${yearsLabel(eff.days)} by ${tenant.groupName}` : yearsLabel(r.retainDays);
              },
            },
            { key: "n", header: "Documents", cell: (r) => counts.get(r.id) ?? 0 },
          ]}
        />
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="type-title-16-medium">Next expiries</h3>
        <p className="type-paragraph-14">
          {`${upcoming.length} ${upcoming.length === 1 ? "document reaches" : "documents reach"} retention end in the next 90 days. Nothing is deleted automatically.`}
        </p>
        {upcoming.length ? (
          <ul className="type-label-14 flex flex-col gap-1">
            {upcoming.map((u) => <li key={u.id}>{`${u.name} · ${format(new Date(u.retainUntil), "d MMM yyyy")}`}</li>)}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
