import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/components/erad/button";
import { Spinner } from "@/components/erad/misc";
import { EmptyState } from "@/components/erad/empty-state";
import { FileText } from "lucide-react";
import { DocumentPage, type SamplePage } from "@/components/review/document-page";
import { FieldRow } from "@/components/review/field-row";
import { documentQuery } from "@/components/documents/document-panel";
import { meQuery } from "@/hooks/use-me";
import { useReviewField, useReviewState } from "@/hooks/use-review";
import { api } from "@/services/api";
import { can } from "@/services/document-rules";
import { nextToCheck, reviewOrder, toCheckCount } from "@/services/review-rules";

export const Route = createFileRoute("/_authenticated/records/$entityId_/review/$docId")({
  head: () => ({
    meta: [
      { title: "Check details · Documents" },
      { name: "description", content: "Check the details read from a document before it is approved." },
      { property: "og:title", content: "Check details · Documents" },
      { property: "og:description", content: "Check the details read from a document before it is approved." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(meQuery),
  component: ReviewPage,
});

function ReviewPage() {
  const { entityId, docId } = Route.useParams();
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const role = me.access?.role ?? "viewer";
  const canReview = can(role, "review");
  const docQ = useQuery(documentQuery(docId));
  const doc = docQ.data?.doc ?? null;
  const review = useReviewState(docId, doc?.document_type ?? "", doc?.current_version_id ?? null);
  const pagesQ = useQuery({ queryKey: ["content", docId, "preview"], queryFn: () => api.getContentUrl(docId, "preview") });
  const decide = useReviewField(entityId, docId);
  const fields = useMemo(() => reviewOrder(review.fields), [review.fields]);
  const [sel, setSel] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const k = toCheckCount(fields);

  const close = () => {
    void navigate({ to: "/records/$entityId", params: { entityId }, search: { doc: docId } }).then(() =>
      setTimeout(() => document.getElementById(`review-${docId}`)?.focus(), 50),
    );
  };

  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !editing) close(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });

  const goNext = (step: 1 | -1 = 1) => {
    const j = nextToCheck(fields, sel, step);
    if (j >= 0) { setSel(j); document.getElementById(`field-${fields[j]?.id}`)?.scrollIntoView({ block: "nearest" }); }
  };
  const run = (fieldId: string, decision: "accept" | "edit" | "reject", value?: string) =>
    decide.mutate({ fieldId, decision, ...(value !== undefined ? { value } : {}) }, { onSuccess: () => { setEditing(null); goNext(); } });

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (editing) return; // shortcuts are off while a value is being edited
    const f = fields[sel];
    if (e.key === "n" || e.key === "N") { e.preventDefault(); goNext(e.shiftKey ? -1 : 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel(Math.min(fields.length - 1, sel + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(Math.max(0, sel - 1)); }
    else if (e.key === "Enter" && e.ctrlKey && f && canReview) { e.preventDefault(); run(f.id, "accept"); }
  };

  if (docQ.isPending || review.isPending) return <Spinner label="Opening the review" />;
  if (docQ.isError || review.isError) {
    return (
      <div className="flex flex-col gap-2">
        <p className="type-paragraph-14">We couldn't open the review just now.</p>
        <Button className="self-start" onClick={() => { void docQ.refetch(); void review.refetch(); }}>Try again</Button>
      </div>
    );
  }
  if (!doc) return <EmptyState icon={FileText} title="This document isn't available to you" cause="It may have been removed, or your access has changed." action={<Link to="/records/$entityId" params={{ entityId }} search={{}} className="type-label-14 underline">Back to the record</Link>} />;

  const pages = (pagesQ.data && pagesQ.data.kind === "sample" ? (pagesQ.data.pages as unknown as SamplePage[] | null) : null) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="type-label-12 text-text-secondary">Check details</span>
          <h1 className="type-title-18-medium">{doc.name}</h1>
        </div>
        <Button onClick={close}>Close review</Button>
      </div>
      {fields.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing to check here" cause="No details were read from this document, so there is nothing to confirm." />
      ) : (
        <div className="grid gap-6 min-[900px]:grid-cols-[3fr_2fr]">
          {pagesQ.isPending ? <Spinner label="Loading the page" /> : <DocumentPage pages={pages} fields={fields} selectedId={fields[sel]?.id ?? null} onSelect={(id) => setSel(Math.max(0, fields.findIndex((f) => f.id === id)))} />}
          <section aria-label="Details" className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="type-label-14" aria-live="polite">{k === 0 ? "All details are checked" : `${k} of ${fields.length} to check`}</p>
              <Button unavailable={k === 0} onClick={() => goNext()}>Next to check</Button>
            </div>
            {!canReview ? <p className="type-label-12 text-text-secondary">Only reviewers and managers can check details. You can still read them.</p> : null}
            <p className="type-label-12 text-text-secondary">Shortcuts in the list: N next to check, Shift+N previous, Ctrl+Enter accept. Nothing is accepted automatically.</p>
            <ul
              role="listbox"
              aria-label="Details read from the document"
              aria-activedescendant={fields[sel] ? `field-${fields[sel].id}` : undefined}
              tabIndex={0}
              onKeyDown={onListKey}
              className="focus-ring flex flex-col border-t border-border-subtle"
            >
              {fields.map((f, i) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  index={i}
                  selected={i === sel}
                  canReview={canReview}
                  busy={decide.isPending}
                  editing={editing === f.id}
                  onSelect={() => setSel(i)}
                  onEditingChange={(on) => setEditing(on ? f.id : null)}
                  onDecide={(d, v) => run(f.id, d, v)}
                />
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
