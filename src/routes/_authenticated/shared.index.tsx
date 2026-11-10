import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { Share2 } from "lucide-react";
import { PageHeader } from "@/components/erad/page-header";
import { EmptyState } from "@/components/erad/empty-state";
import { Tag } from "@/components/erad/tag";
import { Button } from "@/components/erad/button";
import { SkeletonRow } from "@/components/erad/misc";
import { sharedQuery } from "@/hooks/use-shared";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/document-labels";
import type { DocStatus } from "@/schemas/document";

export const Route = createFileRoute("/_authenticated/shared/")({
  head: () => ({
    meta: [
      { title: "Shared with me · Documents" },
      { name: "description", content: "Documents people in your organisation have shared with you directly." },
      { property: "og:title", content: "Shared with me · Documents" },
      { property: "og:description", content: "Documents people in your organisation have shared with you directly." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SharedPage,
});

const PAGE = 20;

function SharedPage() {
  const [page, setPage] = useState(0);
  const q = useQuery(sharedQuery(page));

  return (
    <div>
      <PageHeader title="Shared with me" />
      {q.isPending ? (
        <div>{Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} columns={3} />)}</div>
      ) : q.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="type-paragraph-14">We couldn't load your shared documents just now.</p>
          <Button onClick={() => void q.refetch()}>Try again</Button>
        </div>
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={Share2} title="Nothing shared yet" cause="Nothing has been shared with you yet. When someone shares a document directly, it will appear here." />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border-default rounded-card border border-border-default">
            {q.data.items.map((d) => {
              const meta = [
                d.level === "view" ? "Can view" : "Can edit",
                d.sharedBy ? `Shared by ${d.sharedBy}` : null,
                d.expiresAt ? `Until ${format(new Date(d.expiresAt), "d MMM yyyy")}` : null,
              ].filter(Boolean).join(" · ");
              const cls = "focus-ring flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-btn-default-hover";
              const body = (
                <>
                  <span className="flex flex-col">
                    <span className="type-label-14">{d.name}</span>
                    <span className="type-label-12 text-text-secondary">{d.documentType} · {meta}</span>
                  </span>
                  <Tag tone={STATUS_TONE[d.status as DocStatus]} small>{STATUS_LABEL[d.status as DocStatus]}</Tag>
                </>
              );
              return (
                <li key={d.id}>
                  {d.entityId ? (
                    <Link to="/records/$entityId" params={{ entityId: d.entityId }} search={{ doc: d.id }} className={cls}>{body}</Link>
                  ) : (
                    <Link to="/shared/$docId" params={{ docId: d.id }} search={{ level: d.level === "view" ? "view" : "edit" }} className={cls}>{body}</Link>
                  )}
                </li>
              );
            })}
          </ul>
          {q.data.total > PAGE ? (
            <div className="mt-4 flex items-center gap-2">
              <Button aria-disabled={page === 0} onClick={() => page > 0 && setPage(page - 1)}>Previous</Button>
              <span className="type-label-12 text-text-secondary">Page {page + 1} of {Math.ceil(q.data.total / PAGE)}</span>
              <Button aria-disabled={(page + 1) * PAGE >= q.data.total} onClick={() => (page + 1) * PAGE < q.data.total && setPage(page + 1)}>Next</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
