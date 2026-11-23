import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/erad/button";
import { SkeletonRow } from "@/components/erad/misc";
import { Tag } from "@/components/erad/tag";
import { previewQuery } from "@/hooks/use-document-search";
import { STATUS_LABEL, STATUS_TONE, typeLabel } from "@/lib/document-labels";
import type { SearchFilters } from "@/services/search-rules";
import { startSections, type Section } from "@/components/search/start-sections";

/** The start page: a few short lists instead of everything. Each "See all" opens the full results. */
export function StartLists({
  isAdmin,
  canReview,
  onOpen,
  onSeeAll,
}: {
  isAdmin: boolean;
  canReview: boolean;
  onOpen: (id: string, entityId: string | null) => void;
  onSeeAll: (f: SearchFilters) => void;
}) {
  const sections = startSections({ isAdmin, canReview });
  return (
    // Columns flow like a newspaper, so a short list does not leave a hole beside a long one.
    <div className="gap-6 xl:columns-2">
      {sections.map((s) => (
        <div key={s.title} className="mb-6 break-inside-avoid">
          <StartSection section={s} onOpen={onOpen} onSeeAll={onSeeAll} />
        </div>
      ))}
    </div>
  );
}

function StartSection({
  section,
  onOpen,
  onSeeAll,
}: {
  section: Section;
  onOpen: (id: string, entityId: string | null) => void;
  onSeeAll: (f: SearchFilters) => void;
}) {
  const q = useQuery(previewQuery(section.filters, 5));
  return (
    <section aria-label={section.title} className="flex flex-col">
      <div className="flex h-9 items-center justify-between">
        <h2 className="type-label-12 text-text-secondary">{section.title}</h2>
        {q.data && q.data.items.length > 0 ? (
          <Button
            variant="ghost"
            // Three lists have this link: the name says which one (WCAG 2.4.4).
            aria-label={`See all, ${section.title}`}
            onClick={() => onSeeAll(section.filters)}
          >
            See all
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <ul className="border-t border-border-subtle">
        {q.isPending ? (
          Array.from({ length: 3 }, (_, i) => (
            <li key={i}>
              <SkeletonRow columns={2} />
            </li>
          ))
        ) : q.isError ? (
          <li className="flex items-center justify-between gap-2 py-3">
            <span className="type-paragraph-14">This list couldn't load just now.</span>
            <Button onClick={() => void q.refetch()}>Try again</Button>
          </li>
        ) : q.data.items.length === 0 ? (
          <li className="type-paragraph-14 py-3 text-text-secondary">{section.empty}</li>
        ) : (
          q.data.items.map((d) => (
            <li key={d.id} className="border-b border-border-subtle">
              <button
                type="button"
                onClick={() => onOpen(d.id, d.entity_name ? d.entity_id : null)}
                className="focus-ring group flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-item-hover"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="type-label-14 truncate">{d.name}</span>
                  <span className="type-label-12 truncate text-text-secondary group-hover:text-text-main">
                    {typeLabel(d.document_type)}
                    {d.entity_name ? ` · ${d.entity_name}` : ""}
                    {d.pending > 0 ? ` · ${d.pending} to check` : ""}
                    {section.filters.sort === "expiry" && d.expiry_date
                      ? ` · expires ${d.expiry_date}`
                      : ""}
                  </span>
                </span>
                <Tag tone={STATUS_TONE[d.status]} small>
                  {STATUS_LABEL[d.status]}
                </Tag>
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
