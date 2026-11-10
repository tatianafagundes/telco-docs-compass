import { CheckCircle2 } from "lucide-react";
import { Tag } from "@/components/erad/tag";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/document-labels";
import { approvedSummary } from "@/services/document-actions";
import type { DocStatus } from "@/schemas/document";

interface Item { id: string; name: string; status: DocStatus }

/** Pins the record's current approved document(s) at the top, so the right one is found at a glance. */
export function ApprovedSummary({ items, onOpen }: { items: Item[]; onOpen: (id: string) => void }) {
  const s = approvedSummary(items);
  const linkClass = "focus-ring type-label-14 inline-flex min-h-6 items-center underline";
  return (
    <section aria-labelledby="approved-heading" className="flex flex-col gap-2 rounded-card border border-border-subtle bg-layer-content p-4">
      <h2 id="approved-heading" className="type-label-12 flex items-center gap-1 text-text-secondary">
        <CheckCircle2 aria-hidden="true" className="size-4" />
        Current approved version
      </h2>
      {s.shown.length === 0 ? (
        <p className="type-paragraph-14">
          No approved document yet
          {s.inReview.length > 0 ? (
            <>
              {` · ${s.inReview.length} in review · `}
              <button type="button" className={linkClass} onClick={() => onOpen(s.inReview[0]?.id ?? "")}>Open {s.inReview[0]?.name}</button>
            </>
          ) : null}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {s.shown.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="type-label-14-medium truncate">{d.name}</span>
                <Tag tone={STATUS_TONE[d.status]} small>{STATUS_LABEL[d.status]}</Tag>
              </span>
              <button type="button" className={linkClass} onClick={() => onOpen(d.id)} aria-label={`Open ${d.name}`}>Open</button>
            </li>
          ))}
          {s.more > 0 ? <li className="type-label-12 text-text-secondary">and {s.more} more in the list below</li> : null}
        </ul>
      )}
    </section>
  );
}
