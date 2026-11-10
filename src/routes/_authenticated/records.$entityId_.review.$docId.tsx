import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, Keyboard } from "lucide-react";
import { Button } from "@/components/erad/button";
import { Spinner } from "@/components/erad/misc";
import { EmptyState } from "@/components/erad/empty-state";
import { Dialog } from "@/components/erad/dialog";
import { DocumentPage, type SamplePage } from "@/components/review/document-page";
import { FieldRow } from "@/components/review/field-row";
import { ReviewJourney } from "@/components/review/review-journey";
import { ReviewFooter } from "@/components/review/review-footer";
import { documentQuery } from "@/components/documents/document-panel";
import { meQuery } from "@/hooks/use-me";
import { entitiesQuery } from "@/hooks/use-access";
import { useReviewField, useReviewState } from "@/hooks/use-review";
import { useDocumentActions } from "@/hooks/use-document-actions";
import { api } from "@/services/api";
import { can, contentProtected, isFrozen } from "@/services/document-rules";
import { toCheckCount } from "@/services/review-rules";
import {
  confidenceReason,
  footerAction,
  formatCheck,
  isContractCritical,
  isOwnDocument,
  journeyStep,
  mostUrgent,
  outcomeSummary,
  pageOrder,
  recordMatch,
} from "@/services/review-flow-rules";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/records/$entityId_/review/$docId")({
  head: () => ({
    meta: [
      { title: "Check details · Documents" },
      { name: "description", content: "Confirm the details read from a document, then approve it in one place." },
      { property: "og:title", content: "Check details · Documents" },
      { property: "og:description", content: "Confirm the details read from a document, then approve it in one place." },
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
  const docQ = useQuery(documentQuery(docId));
  const entities = useQuery(entitiesQuery);
  const doc = docQ.data?.doc ?? null;
  const closed = doc ? isFrozen(doc.status) || contentProtected(doc.status) : false;
  const canReview = can(role, "review") && !closed;
  const review = useReviewState(docId, doc?.document_type ?? "", doc?.current_version_id ?? null);
  const pagesQ = useQuery({ queryKey: ["content", docId, "preview"], queryFn: () => api.getContentUrl(docId, "preview") });
  const decide = useReviewField(entityId, docId);
  const actions = useDocumentActions(entityId, docId);
  const fields = useMemo(() => pageOrder(review.fields), [review.fields]);
  const [sel, setSel] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<"details" | "document">("details");
  const [showKeys, setShowKeys] = useState(false);

  const entity = entities.data?.find((e) => e.id === entityId);
  const record = entity ? { id: entity.id, displayName: entity.display_name } : null;
  const critical = (name: string) => isContractCritical(review.spec, name);
  const checks = fields.map((f) => {
    const match = recordMatch(f.name, f.value, record);
    const fmt = formatCheck(f.name, f.value);
    return { match, flagged: match === "differs" || (fmt !== null && !fmt.ok), reason: confidenceReason(f.band, match, fmt) };
  });
  const k = toCheckCount(fields);
  const own = isOwnDocument((doc as { created_by?: string | null } | null)?.created_by, me.userId);
  const action = doc ? footerAction({ role, status: doc.status, toCheck: canReview ? k : 0, gate: review.gate, own }) : null;
  const step = doc ? journeyStep(doc.status, k) : null;

  const back = () => {
    void navigate({ to: "/records/$entityId", params: { entityId }, search: { doc: docId } }).then(() =>
      setTimeout(() => document.getElementById(`review-${docId}`)?.focus(), 50),
    );
  };

  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !editing && !showKeys) back(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });

  const focusRow = (j: number) => {
    setSel(j);
    setTab("details");
    setTimeout(() => document.getElementById(`field-${fields[j]?.id}`)?.scrollIntoView({ block: "nearest" }), 0);
  };
  const goNext = () => {
    const j = mostUrgent(fields, critical, (name) => checks[fields.findIndex((f) => f.name === name)]?.flagged ?? false);
    if (j >= 0) focusRow(j);
  };
  const run = (fieldId: string, decision: "accept" | "edit" | "reject", value?: string) =>
    decide.mutate({ fieldId, decision, ...(value !== undefined ? { value } : {}) }, { onSuccess: () => { setEditing(null); goNext(); } });

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (editing) return; // shortcuts are off while a value is being corrected
    const f = fields[sel];
    const key = e.key.toLowerCase();
    if (key === "j" || e.key === "ArrowDown") { e.preventDefault(); focusRow(Math.min(fields.length - 1, sel + 1)); }
    else if (key === "k" || e.key === "ArrowUp") { e.preventDefault(); focusRow(Math.max(0, sel - 1)); }
    else if (key === "n") { e.preventDefault(); goNext(); }
    else if (f && canReview && f.status === "pending" && key === "c") { e.preventDefault(); run(f.id, "accept"); }
    else if (f && canReview && key === "e") { e.preventDefault(); setEditing(f.id); }
  };

  if (docQ.isPending || review.isPending) return <Spinner label="Opening the details" />;
  if (docQ.isError || review.isError) {
    return (
      <div className="flex flex-col gap-2">
        <p className="type-paragraph-14">We couldn't open the details just now.</p>
        <Button className="self-start" onClick={() => { void docQ.refetch(); void review.refetch(); }}>Try again</Button>
      </div>
    );
  }
  if (!doc) return <EmptyState icon={FileText} title="This document isn't available to you" cause="It may have been removed, or your access has changed." action={<Link to="/records/$entityId" params={{ entityId }} search={{}} className="type-label-14 underline">Back to the record</Link>} />;

  const pages = (pagesQ.data && pagesQ.data.kind === "sample" ? (pagesQ.data.pages as unknown as SamplePage[] | null) : null) ?? [];
  const pagePane = pagesQ.isPending ? <Spinner label="Loading the page" /> : (
    <DocumentPage pages={pages} fields={fields} selectedId={fields[sel]?.id ?? null} onSelect={(id) => focusRow(Math.max(0, fields.findIndex((f) => f.id === id)))} />
  );

  return (
    <div className="flex min-h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <button type="button" onClick={back} className="focus-ring type-label-12 inline-flex min-h-6 items-center gap-1 self-start text-text-secondary hover:underline">
            <ArrowLeft aria-hidden="true" className="size-3" />Back to document
          </button>
          <h1 className="type-title-18-medium">Check details · {doc.name}</h1>
          {step !== null ? <ReviewJourney step={step} /> : null}
        </div>
        <Button onClick={() => setShowKeys(true)}><Keyboard aria-hidden="true" />Keyboard shortcuts</Button>
      </div>

      {fields.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing to check here" cause="No details were read from this document, so you can go straight to approval." />
      ) : (
        <>
          <div role="tablist" aria-label="View" className="flex gap-4 border-b border-border-subtle min-[900px]:hidden">
            {(["details", "document"] as const).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("focus-ring type-label-14 h-8 border-b-2 px-1", tab === t ? "border-border-selected text-text-main" : "border-transparent text-text-secondary")}>
                {t === "details" ? `Details${k ? ` (${k} to check)` : ""}` : "Document"}
              </button>
            ))}
          </div>
          <div className="grid flex-1 gap-6 min-[900px]:grid-cols-[3fr_2fr]">
            <div className={cn(tab === "document" ? "block" : "hidden", "min-[900px]:block")}>{pagePane}</div>
            <section aria-label="Details" className={cn("min-w-0 flex-col gap-2", tab === "details" ? "flex" : "hidden", "min-[900px]:flex")}>
              {k === 0 ? <p className="type-label-14 text-status-cleared" role="status">{outcomeSummary(fields)}</p> : null}
              {closed ? <p className="type-label-12 text-text-secondary">This document is closed, so its checked details are kept as they are.</p> : !canReview ? <p className="type-label-12 text-text-secondary">Only reviewers and managers can check details. You can still read them.</p> : null}
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
                    marker={i + 1}
                    selected={i === sel}
                    canReview={canReview}
                    busy={decide.isPending}
                    editing={editing === f.id}
                    critical={critical(f.name)}
                    match={checks[i]?.match ?? null}
                    reason={checks[i]?.reason ?? ""}
                    onSelect={() => setSel(i)}
                    onEditingChange={(on) => setEditing(on ? f.id : null)}
                    onDecide={(d, v) => run(f.id, d, v)}
                  />
                ))}
              </ul>
            </section>
          </div>
        </>
      )}

      {action ? (
        <ReviewFooter
          checked={fields.length - k}
          total={fields.length}
          action={action}
          busy={actions.transition.isPending}
          onNext={goNext}
          onDone={back}
          onTransition={() => { if (action.kind === "transition") actions.transition.mutate({ to: action.to }); }}
        />
      ) : null}

      <Dialog
        open={showKeys}
        onOpenChange={setShowKeys}
        title="Keyboard shortcuts"
        description="These work when the list of details has focus. Nothing is confirmed automatically."
        actions={<Button variant="primary" onClick={() => setShowKeys(false)}>Done</Button>}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {[["J / ↓", "Next detail in the list"], ["K / ↑", "Previous detail"], ["N", "Most urgent detail to check"], ["C", "Confirm the selected detail"], ["E", "Correct the selected detail"], ["Esc", "Back to document"]].map(([key, what]) => (
            <div key={key} className="contents">
              <dt><kbd className="type-code-14 rounded-control border border-border-subtle px-1">{key}</kbd></dt>
              <dd className="type-paragraph-14">{what}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </div>
  );
}
