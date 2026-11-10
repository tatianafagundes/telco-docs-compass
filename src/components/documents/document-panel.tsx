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
import type { AppRole } from "@/services/document-rules";

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: ["document", id],
    queryFn: async () => {
      const [doc, versions, activity] = await Promise.all([api.get(id), api.listVersions(id), api.listActivity(id)]);
      return { doc, versions, activity };
    },
  });

export function DocumentPanel({ id, entityId, role }: { id: string; entityId: string; role: AppRole }) {
  const q = useQuery(documentQuery(id));
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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h3 className="type-title-16-medium">{doc.name}</h3>
        <div className="flex flex-wrap gap-2">
          <Tag tone={STATUS_TONE[doc.status]} small>{STATUS_LABEL[doc.status]}</Tag>
          <Tag tone={PIPELINE_TONE[doc.pipeline_state]} small>{PIPELINE_LABEL[doc.pipeline_state]}</Tag>
          {doc.legal_hold ? <Tag tone="major" icon={<Lock aria-hidden="true" className="size-4" />}>On hold</Tag> : null}
        </div>
        {current ? <p className="type-label-12 text-text-secondary">Version {current.label} · {format(new Date(current.created_at), "d MMM yyyy")}</p> : null}
      </header>

      <DocumentActionsBar entityId={entityId} role={role} doc={doc} />
      <DocumentDetails key={doc.updated_at} entityId={entityId} role={role} doc={doc} />

      <section aria-label="Activity" className="flex flex-col gap-2">
        <h4 className="type-label-12 text-text-secondary">Recent activity</h4>
        {activity.length === 0 ? (
          <p className="type-paragraph-14 text-text-secondary">Nothing has happened here yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {activity.map((e) => (
              <li key={e.id} className="flex flex-col">
                <span className="type-label-14">{activityLabel(e.action)}{e.detail ? ` · ${activityDetail(e.detail)}` : ""}</span>
                <span className="type-label-12 text-text-secondary">{format(new Date(e.created_at), "d MMM yyyy, HH:mm")}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
