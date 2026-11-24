import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/erad/page-header";
import { EmptyState } from "@/components/erad/empty-state";
import { SidePanel } from "@/components/erad/side-panel";
import { useEffect, useState } from "react";
import { AddDocuments } from "@/components/upload/add-documents";
import { useUpload } from "@/hooks/use-upload";
import { Tag } from "@/components/erad/tag";
import { SkeletonRow } from "@/components/erad/misc";
import { DocumentPanel } from "@/components/documents/document-panel";
import { ApprovedSummary } from "@/components/documents/approved-summary";
import { meQuery } from "@/hooks/use-me";
import {
  storedPipelineLabel,
  PIPELINE_TONE,
  recordKindLabel,
  STATUS_LABEL,
  STATUS_TONE,
  typeLabel,
} from "@/lib/document-labels";
import { api } from "@/services/api";
import { DataTable } from "@/components/erad/data-table";
import { EmptyCell } from "@/components/erad/empty-cell";
import { Pagination } from "@/components/erad/pagination";
import { tableDate } from "@/lib/table-format";
import { pollDelay, processingView, waitingLine } from "@/lib/pipeline-copy";
import { Banner } from "@/components/erad/banner";
import { Button } from "@/components/erad/button";
import { ProcessingAnnouncer } from "@/components/documents/processing-announcer";
/** EDS pagination: 25 documents per page on a record. */
const RECORD_PAGE = 25;
import {
  DEFAULT_RECORD_SORT,
  nextRecordSort,
  sortRecordDocs,
  type RecordSort,
  type RecordSortKey,
} from "@/lib/record-docs";
import type { DocStatus, PipelineState } from "@/schemas/document";

// find() builds its select string dynamically, so its row type is narrowed here.
interface DocListItem {
  id: string;
  name: string;
  status: DocStatus;
  pipeline_state: PipelineState;
  pipeline_detail?: unknown;
  legal_hold: boolean;
  current_version_id: string | null;
  document_type: string | null;
  updated_at: string | null;
  extraction_fields?: { status: string; version_id: string }[];
}

const toCheck = (d: DocListItem) =>
  (d.extraction_fields ?? []).filter(
    (f) => f.status === "pending" && f.version_id === d.current_version_id,
  ).length;

const recordQuery = (entityId: string) =>
  queryOptions({
    queryKey: ["documents", { entityId }],
    queryFn: async () => {
      const [entities, found] = await Promise.all([api.listEntities(), api.find({ entityId })]);
      return {
        entity: entities.find((e) => e.id === entityId) ?? null,
        items: found.items as unknown as DocListItem[],
      };
    },
  });

export const Route = createFileRoute("/_authenticated/records/$entityId")({
  validateSearch: z.object({
    doc: z.string().uuid().optional(),
    // Set by "Add documents" on the Documents page; used once, then removed from the address.
    add: z.literal(1).optional().catch(undefined),
  }),
  head: () => ({
    meta: [
      { title: "Record · Documents" },
      {
        name: "description",
        content: "Documents attached to this record, with status and processing.",
      },
      { property: "og:title", content: "Record · Documents" },
      {
        property: "og:description",
        content: "Documents attached to this record, with status and processing.",
      },
    ],
  }),
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(recordQuery(params.entityId)),
      context.queryClient.ensureQueryData(meQuery),
    ]);
  },
  pendingComponent: () => (
    <div>
      {Array.from({ length: 5 }, (_, i) => (
        <SkeletonRow key={i} columns={3} />
      ))}
    </div>
  ),
  component: RecordPage,
});

function RecordPage() {
  const { entityId } = Route.useParams();
  const { doc, add } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // While a shown document waits for an outside system, the one list query refetches (R5.4); React
  // Query stops while the tab is hidden and refetches when it is shown again.
  const list = useSuspenseQuery({
    ...recordQuery(entityId),
    refetchInterval: (q) => pollDelay(q.state.data?.items ?? [], Date.now()),
  });
  const { data } = list;
  const waiting = pollDelay(data.items, Date.now()) !== false;
  const { data: me } = useSuspenseQuery(meQuery);
  const role = me.access?.role ?? "viewer";
  const entityKind = data.entity?.referred_type === "Account" ? "account" : "order";
  const upload = useUpload(entityId);
  const { sync } = upload;
  // The progress card follows the list: an outside system's answer or a timeout reaches it too.
  useEffect(() => sync(data.items), [data.items, sync]);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sort, setSort] = useState<RecordSort>(DEFAULT_RECORD_SORT);
  const [pageWanted, setPage] = useState(0);
  const openDoc = (id: string) => void navigate({ search: { doc: id } });
  // Remember the arrival for this visit, then drop `add` so Back and Reload don't repeat it.
  const [arriving] = useState(add === 1);
  useEffect(() => {
    if (add === 1)
      void navigate({ search: (prev) => ({ ...prev, add: undefined }), replace: true });
  }, [add, navigate]);
  // "Ready" stays visible on rows added in this visit.
  const addedHere = new Map(
    upload.rows.filter((r) => r.docId).map((r) => [r.docId as string, r.state]),
  );
  const items = attentionOnly
    ? data.items.filter((d) => d.pipeline_state === "failed" || d.pipeline_state === "quarantined")
    : data.items;

  // A shorter list (Show needs attention) can leave the page past its end: stay on the last one.
  const page = Math.min(pageWanted, Math.max(0, Math.ceil(items.length / RECORD_PAGE) - 1));
  if (!data.entity) {
    return (
      <EmptyState
        icon={FileText}
        title="This record isn't available to you"
        cause="It may belong to another team, or your access has changed."
        action={
          <Link to="/documents" className="type-label-14 underline">
            Back to documents
          </Link>
        }
      />
    );
  }

  return (
    <div className="relative flex min-h-full gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Link
          to="/documents"
          className="focus-ring type-label-12 inline-flex min-h-6 items-center self-start text-text-secondary hover:underline"
        >
          Documents
        </Link>
        <div className="flex flex-col gap-1">
          <PageHeader title={data.entity.display_name} />
          <p className="type-label-12 -mt-3 text-text-secondary">
            {recordKindLabel(data.entity.referred_type)}
            {/* The record's own status in its source system (CPQ, Order care), not a document status. */}
            {data.entity.status_label
              ? ` · ${recordKindLabel(data.entity.referred_type)} status in source system: ${data.entity.status_label.toLowerCase()}`
              : ""}
            {` · ${data.items.length} ${data.items.length === 1 ? "document" : "documents"}`}
          </p>
        </div>
        <ProcessingAnnouncer docs={data.items} />
        {list.isRefetchError ? (
          <Banner
            tone="warning"
            status="Can't refresh right now"
            action={
              <Button onClick={() => void list.refetch()} unavailable={list.isFetching}>
                Check now
              </Button>
            }
          >
            The states shown may be out of date.
          </Banner>
        ) : waiting ? (
          <p className="type-label-14 flex flex-wrap items-center gap-2 text-text-secondary">
            Some files are waiting for your organisation's systems. This list updates on its own.
            <Button onClick={() => void list.refetch()} unavailable={list.isFetching}>
              Check now
            </Button>
          </p>
        ) : null}
        <ApprovedSummary
          items={data.items}
          onOpen={(id) => void navigate({ search: { doc: id } })}
        />
        <AddDocuments
          entityId={entityId}
          entityKind={entityKind}
          role={role}
          existing={data.items.map((d) => ({
            id: d.id,
            name: d.name,
            pipeline_detail: d.pipeline_detail,
          }))}
          upload={upload}
          onShowAttention={() => setAttentionOnly(true)}
          arrivingFor={arriving ? data.entity.display_name : null}
          recordName={data.entity.display_name}
          secondary={Boolean(doc)}
        >
          {attentionOnly ? (
            <p className="type-label-14 flex items-center gap-2">
              Showing files that need attention.
              <button
                type="button"
                className="focus-ring underline"
                onClick={() => setAttentionOnly(false)}
              >
                Show all
              </button>
            </p>
          ) : null}
          {items.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents on this record yet"
              cause="You can add files with the button above, or drop them here."
            />
          ) : (
            <div className="flex flex-col gap-2 overflow-x-auto">
              {/* EDS table anatomy: the number of items above, pagination below. */}
              <p className="type-label-14 text-text-secondary">
                {items.length === 1 ? "1 document" : `${items.length} documents`}
              </p>
              <DataTable
                caption={`Documents on ${data.entity.display_name}`}
                rows={sortRecordDocs(items, sort, typeLabel).slice(
                  page * RECORD_PAGE,
                  (page + 1) * RECORD_PAGE,
                )}
                rowId={(d) => d.id}
                {...(doc ? { activeId: doc } : {})}
                onActivate={openDoc}
                sort={sort}
                onSort={(k) => {
                  setSort((s) => nextRecordSort(s, k as RecordSortKey));
                  setPage(0);
                }}
                columns={[
                  {
                    key: "name",
                    header: "Name",
                    sortable: true,
                    cell: (d) => (
                      <span className="flex min-w-0 flex-col py-1">
                        <button
                          type="button"
                          aria-current={d.id === doc || undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDoc(d.id);
                          }}
                          title={d.name}
                          className="focus-ring type-label-14 truncate text-left underline-offset-2 hover:underline"
                        >
                          {d.name}
                        </button>
                        {toCheck(d) > 0 ? (
                          <span className="type-label-12 text-text-secondary">
                            {toCheck(d)} to check
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: "type",
                    header: "Type",
                    sortable: true,
                    cell: (d) => (d.document_type ? typeLabel(d.document_type) : <EmptyCell />),
                  },
                  {
                    key: "status",
                    header: "Status",
                    cell: (d) => (
                      <span className="flex flex-wrap gap-2">
                        <Tag tone={STATUS_TONE[d.status]} small>
                          {STATUS_LABEL[d.status]}
                        </Tag>
                        {d.legal_hold ? <Tag small>On hold</Tag> : null}
                        {d.pipeline_state !== "ready" ? (
                          <Tag tone={PIPELINE_TONE[d.pipeline_state]} small>
                            {storedPipelineLabel(
                              d.pipeline_state,
                              addedHere.get(d.id) === "uploading",
                            )}
                          </Tag>
                        ) : null}
                        {(() => {
                          const w = processingView(d.pipeline_state, d.pipeline_detail).waiting;
                          return w ? (
                            <span className="type-label-12 basis-full text-text-secondary">
                              {waitingLine(w)}
                            </span>
                          ) : null;
                        })()}
                        {d.pipeline_state === "ready" && addedHere.has(d.id) ? (
                          <Tag tone="cleared" small>
                            Ready
                          </Tag>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: "changed",
                    header: "Changed",
                    sortable: true,
                    cell: (d) => (d.updated_at ? tableDate(d.updated_at) : <EmptyCell />),
                  },
                ]}
              />
              <Pagination
                page={page}
                pageSize={RECORD_PAGE}
                total={items.length}
                onPage={setPage}
                label="documents"
              />
            </div>
          )}
        </AddDocuments>
      </div>
      {doc ? (
        <SidePanel
          title="Document"
          collapsed={false}
          onCollapsedChange={() => void navigate({ search: {} })}
        >
          <DocumentPanel id={doc} entityId={entityId} role={role} showRecord={false} />
        </SidePanel>
      ) : null}
    </div>
  );
}
