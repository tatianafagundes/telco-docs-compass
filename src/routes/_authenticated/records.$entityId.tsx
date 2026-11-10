import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/erad/page-header";
import { EmptyState } from "@/components/erad/empty-state";
import { SidePanel } from "@/components/erad/side-panel";
import { Lock } from "lucide-react";
import { Tag } from "@/components/erad/tag";
import { SkeletonRow } from "@/components/erad/misc";
import { DocumentPanel } from "@/components/documents/document-panel";
import { meQuery } from "@/hooks/use-me";
import { PIPELINE_LABEL, PIPELINE_TONE, STATUS_LABEL, STATUS_TONE } from "@/lib/document-labels";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import type { DocStatus, PipelineState } from "@/schemas/document";

// find() builds its select string dynamically, so its row type is narrowed here.
interface DocListItem { id: string; name: string; status: DocStatus; pipeline_state: PipelineState }

const recordQuery = (entityId: string) =>
  queryOptions({
    queryKey: ["documents", { entityId }],
    queryFn: async () => {
      const [entities, found] = await Promise.all([api.listEntities(), api.find({ entityId })]);
      return { entity: entities.find((e) => e.id === entityId) ?? null, items: found.items as unknown as DocListItem[] };
    },
  });

export const Route = createFileRoute("/_authenticated/records/$entityId")({
  validateSearch: z.object({ doc: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Record · Documents" },
      { name: "description", content: "Documents attached to this record, with status and processing." },
      { property: "og:title", content: "Record · Documents" },
      { property: "og:description", content: "Documents attached to this record, with status and processing." },
    ],
  }),
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(recordQuery(params.entityId)),
      context.queryClient.ensureQueryData(meQuery),
    ]);
  },
  pendingComponent: () => <div>{Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} columns={3} />)}</div>,
  component: RecordPage,
});

function RecordPage() {
  const { entityId } = Route.useParams();
  const { doc } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(recordQuery(entityId));
  const { data: me } = useSuspenseQuery(meQuery);
  const role = me.access?.role ?? "viewer";

  if (!data.entity) {
    return <EmptyState icon={FileText} title="This record isn't available to you" cause="It may belong to another team, or your access has changed." action={<Link to="/documents" className="type-label-14 underline">Back to documents</Link>} />;
  }

  return (
    <div className="relative flex min-h-full gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Link to="/documents" className="type-label-12 text-text-secondary hover:underline">Documents</Link>
        <PageHeader title={data.entity.display_name} />
        {data.items.length === 0 ? (
          <EmptyState icon={FileText} title="No documents on this record yet" cause="Documents appear here once they're added to this record." />
        ) : (
          <ul className="border-t border-border-subtle">
            {data.items.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  aria-current={d.id === doc || undefined}
                  onClick={() => void navigate({ search: { doc: d.id } })}
                  className={cn(
                    "focus-ring flex min-h-12 w-full items-center justify-between gap-4 border-b border-border-subtle px-4 py-2 text-left hover:bg-item-hover",
                    d.id === doc && "bg-item-selected",
                  )}
                >
                  <span className="type-label-14 truncate">{d.name}</span>
                  <span className="flex shrink-0 gap-2">
                    <Tag tone={STATUS_TONE[d.status]} small>{STATUS_LABEL[d.status]}</Tag>
                    {d.legal_hold ? <Tag tone="major" icon={<Lock aria-hidden="true" className="size-4" />}>On hold</Tag> : null}
                    {d.pipeline_state !== "ready" ? <Tag tone={PIPELINE_TONE[d.pipeline_state]} small>{PIPELINE_LABEL[d.pipeline_state]}</Tag> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {doc ? (
        <SidePanel title="Document" collapsed={false} onCollapsedChange={() => void navigate({ search: {} })}>
          <DocumentPanel id={doc} entityId={entityId} role={role} />
        </SidePanel>
      ) : null}
    </div>
  );
}
