import { queryOptions, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/erad/button";
import { Lock } from "lucide-react";
import { Tag } from "@/components/erad/tag";
import { Spinner } from "@/components/erad/misc";
import { DocumentActionsBar } from "@/components/documents/document-actions-bar";
import { DocumentDetails } from "@/components/documents/document-details";
import { activityDetail, activityLabel, PIPELINE_LABEL, PIPELINE_TONE, STATUS_LABEL, STATUS_TONE } from "@/lib/document-labels";
import { api } from "@/services/api";
import { can, type AppRole } from "@/services/document-rules";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Banner } from "@/components/erad/banner";
import { ManageAccessDialog } from "@/components/access/manage-access-dialog";
import { WhyCanISee } from "@/components/access/why-can-i-see";
import { useReviewState } from "@/hooks/use-review";
import { bannerText, toCheckCount } from "@/services/review-rules";
import { isOwnDocument, journeyStep } from "@/services/review-flow-rules";
import { ReviewJourney } from "@/components/review/review-journey";
import { meQuery } from "@/hooks/use-me";

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: ["document", id],
    queryFn: async () => {
      const [doc, versions, activity] = await Promise.all([api.get(id), api.listVersions(id), api.listActivity(id)]);
      return { doc, versions, activity };
    },
  });

/** entityId null: reached only through a direct share; record details stay hidden. */
export function DocumentPanel({ id, entityId, role }: { id: string; entityId: string | null; role: AppRole }) {
  const shared = entityId === null;
  const recordId = entityId ?? "";
  const q = useQuery(documentQuery(id));
  const [sharing, setSharing] = useState(false);
  const [allActivity, setAllActivity] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const review = useReviewState(id, q.data?.doc?.document_type ?? "", q.data?.doc?.current_version_id ?? null);
  const toCheck = toCheckCount(review.fields);
  const me = useQuery(meQuery);
  if (q.isPending) return <Spinner label="Opening document" />;
  if (q.isError) {
    return (
      <div className="flex flex-col gap-2">
        <p className="type-paragraph-14">We couldn't open this document just now.</p>
        <Button onClick={() => void q.refetch()} className="self-start">Try again</Button>
      </div>
    );
  }
  const { doc, versions, activity } = q.data;
  if (!doc) return <p className="type-paragraph-14">This document isn't available to you, or it has been removed.</p>;
  const current = versions.find((v) => v.id === doc.current_version_id) ?? versions[0];

  const headerBlock = (
    <>
      <h3 className="type-title-16-medium">{doc.name}</h3>
      <div className="flex flex-wrap gap-2">
        <Tag tone={STATUS_TONE[doc.status]} small>{STATUS_LABEL[doc.status]}</Tag>
        <Tag tone={PIPELINE_TONE[doc.pipeline_state]} small>{PIPELINE_LABEL[doc.pipeline_state]}</Tag>
        {doc.legal_hold ? <Tag tone="major" icon={<Lock aria-hidden="true" className="size-4" />}>On hold</Tag> : null}
      </div>
      {shared ? <p className="type-label-12 text-text-secondary">Part of a record you don't have access to</p> : null}
      {!shared && journeyStep(doc.status, toCheck) !== null ? <ReviewJourney step={journeyStep(doc.status, toCheck) ?? 0} /> : null}
      {current ? <p className="type-label-12 text-text-secondary">Version {current.label} · {format(new Date(current.created_at), "d MMM yyyy")}</p> : null}
    </>
  );
  const extraMenu = [
    ...(!shared && can(role, "manage") ? [{ label: "Manage access", onSelect: () => setSharing(true) }] : []),
    { label: "Why can I see this?", onSelect: () => setShowWhy(true) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <DocumentActionsBar
          entityId={recordId}
          role={role}
          doc={doc}
          approveGate={review.gate}
          own={isOwnDocument((doc as { created_by?: string | null }).created_by, me.data?.userId ?? "")}
          header={headerBlock}
          extraMenu={extraMenu}
        />
        {toCheck > 0 ? (
          <Banner
            tone="indeterminate"
            status={`${toCheck} to check`}
            action={shared ? undefined : <Link
              id={`review-${id}`}
              to="/records/$entityId/review/$docId"
              params={{ entityId: recordId, docId: id }}
              className="focus-ring type-label-14 inline-flex h-8 items-center rounded-control border border-border-btn px-3 hover:bg-btn-default-hover"
            >
              Check details
            </Link>}
          >
            {bannerText(toCheck)}
          </Banner>
        ) : review.fields.length > 0 ? (
          <p className="type-label-12 text-text-secondary">All details read from this document are checked.</p>
        ) : null}
        {showWhy ? <WhyCanISee key="why" docId={id} initiallyOpen /> : null}
      </div>
      <ManageAccessDialog docId={id} open={sharing} onOpenChange={setSharing} />

      <section aria-labelledby={`details-${id}`} className="flex flex-col gap-2 border-t border-border-subtle pt-4">
        <h4 id={`details-${id}`} className="type-label-12 text-text-secondary">Details</h4>
        <DocumentDetails key={doc.updated_at} entityId={recordId} role={role} doc={doc} />
      </section>

      <section aria-labelledby={`activity-${id}`} className="flex flex-col gap-2 border-t border-border-subtle pt-4">
        <h4 id={`activity-${id}`} className="type-label-12 text-text-secondary">Activity</h4>
        {activity.length === 0 ? (
          <p className="type-paragraph-14 text-text-secondary">Nothing has happened here yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {(allActivity ? activity : activity.slice(0, 5)).map((e) => (
              <li key={e.id} className="flex flex-col">
                <span className="type-label-14">{activityLabel(e.action)}{e.detail ? ` · ${activityDetail(e.detail)}` : ""}</span>
                <span className="type-label-12 text-text-secondary">{format(new Date(e.created_at), "d MMM yyyy, HH:mm")}</span>
              </li>
            ))}
          </ol>
        )}
        {activity.length > 5 ? (
          <button type="button" className="focus-ring type-label-12 inline-flex min-h-6 items-center self-start underline" onClick={() => setAllActivity(!allActivity)}>
            {allActivity ? "Show recent only" : `Show all ${activity.length}`}
          </button>
        ) : null}
      </section>
    </div>
  );
}
