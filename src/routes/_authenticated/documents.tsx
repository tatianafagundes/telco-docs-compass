import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search, FolderOpen } from "lucide-react";
import { PageHeader } from "@/components/erad/page-header";
import { TextField } from "@/components/erad/text-field";
import { EmptyState } from "@/components/erad/empty-state";
import { Tag } from "@/components/erad/tag";
import { SkeletonRow } from "@/components/erad/misc";
import { listEntities } from "@/services/document.functions";

const entitiesQuery = queryOptions({ queryKey: ["entities", {}], queryFn: () => listEntities() });

const GROUPS: { label: string; types: string[] }[] = [
  { label: "Quotes", types: ["Quote"] },
  { label: "Orders", types: ["ProductOrder"] },
  { label: "Accounts", types: ["Account"] },
  { label: "Customers", types: ["Customer"] },
];

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({
    meta: [
      { title: "Documents" },
      { name: "description", content: "Quotes, orders, accounts and customers with their documents." },
      { property: "og:title", content: "Documents" },
      { property: "og:description", content: "Quotes, orders, accounts and customers with their documents." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(entitiesQuery),
  pendingComponent: () => (
    <div>{Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} columns={2} />)}</div>
  ),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { data } = useSuspenseQuery(entitiesQuery);
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => data.filter((e) => !f || e.display_name.toLowerCase().includes(f) || e.id.toLowerCase().includes(f)),
    [data, f],
  );

  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      <PageHeader title="Documents" />
      <TextField
        label="Filter by name or number"
        prefix={<Search className="size-4" aria-hidden="true" />}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {data.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No records shared with you yet" cause="Records appear here once an administrator gives you access." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="Nothing matches that filter" cause={`No record name or number contains "${filter}". You can try a shorter word.`} />
      ) : (
        GROUPS.map((g) => {
          const items = filtered.filter((e) => g.types.includes(e.referred_type));
          if (items.length === 0) return null;
          return (
            <section key={g.label} aria-label={g.label}>
              <h2 className="type-label-12 flex h-[30px] items-center text-text-secondary">{g.label}</h2>
              <ul className="border-t border-border-subtle">
                {items.map((e) => (
                  <li key={e.id} className="border-b border-border-subtle">
                    <Link to="/records/$entityId" params={{ entityId: e.id }} className="focus-ring flex h-12 items-center justify-between gap-4 px-4 hover:bg-item-hover">
                      <span className="type-label-14 truncate">{e.display_name}</span>
                      {e.status_label ? <Tag tone="indeterminate" small>{e.status_label}</Tag> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
