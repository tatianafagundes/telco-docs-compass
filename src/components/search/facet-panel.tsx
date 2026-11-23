import { Checkbox } from "@/components/erad/checkbox";
import { Skeleton } from "@/components/erad/misc";
import { useDocumentCount, useEntityKindCounts, useFacets } from "@/hooks/use-document-search";
import { STATUS_LABEL, typeLabel } from "@/lib/document-labels";
import type { DocStatus } from "@/schemas/document";
import { ENTITY_TYPES, SENSITIVITIES, STATUSES, type SearchFilters } from "@/services/search-rules";

const SENS_LABEL: Record<string, string> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  restricted: "Restricted",
};
const ENTITY_LABEL: Record<string, string> = {
  ProductOrder: "Orders",
  Quote: "Quotes",
  Agreement: "Agreements",
  BillingAccount: "Accounts",
  Customer: "Customers",
  TroubleTicket: "Tickets",
  Site: "Sites",
};

type ListKey = "types" | "statuses" | "sensitivity" | "entityTypes";

function toggle(list: string[] | undefined, v: string): string[] {
  const s = new Set(list ?? []);
  if (s.has(v)) s.delete(v);
  else s.add(v);
  return [...s];
}

/** Filters with counts. Counts come from the server under the other active filters. */
export function FacetPanel({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
}) {
  const facets = useFacets(filters);
  const counts = facets.data;
  // The facet query has no count for these two; ask the count query, under the other filters.
  const toCheck = useDocumentCount({ ...filters, review: true });
  const perKind = useEntityKindCounts(filters, ENTITY_TYPES);

  const group = (
    title: string,
    key: ListKey,
    options: { value: string; label: string }[],
    countKey?: "types" | "statuses" | "sensitivity",
    countOf?: (value: string) => number | undefined,
  ) => {
    const selected = (filters[key] as string[] | undefined) ?? [];
    const visible =
      countKey && counts
        ? options.filter((o) => (counts[countKey][o.value] ?? 0) > 0 || selected.includes(o.value))
        : options;
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="type-label-12 mb-1 text-text-secondary">{title}</legend>
        {visible.length === 0 ? (
          <p className="type-paragraph-14 text-text-secondary">None in these results</p>
        ) : null}
        {visible.map((o) => (
          <div key={o.value} className="flex items-center justify-between gap-2">
            <Checkbox
              label={o.label}
              checked={selected.includes(o.value)}
              onCheckedChange={() => onChange({ ...filters, [key]: toggle(selected, o.value) })}
            />
            {countKey || countOf ? (
              <FacetCount
                n={
                  countKey
                    ? facets.isPending
                      ? undefined
                      : (counts?.[countKey][o.value] ?? 0)
                    : countOf?.(o.value)
                }
              />
            ) : null}
          </div>
        ))}
      </fieldset>
    );
  };

  const typeOptions = Object.keys(counts?.types ?? {})
    .concat(filters.types ?? [])
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort()
    .map((v) => ({ value: v, label: typeLabel(v) }));

  return (
    <div className="flex flex-col gap-5" aria-label="Filters" role="group">
      {facets.isError ? (
        <p className="type-paragraph-14 text-text-secondary">
          Counts aren't available right now. Filters still work.
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="type-label-12 mb-1 text-text-secondary">Needs attention</legend>
        <div className="flex items-center justify-between gap-2">
          <Checkbox
            label="Details to check"
            checked={Boolean(filters.review)}
            onCheckedChange={(c) => onChange({ ...filters, review: c === true || undefined })}
          />
          <FacetCount n={toCheck.data} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Checkbox
            label="On legal hold"
            checked={Boolean(filters.hold)}
            onCheckedChange={(c) => onChange({ ...filters, hold: c === true || undefined })}
          />
          <FacetCount n={facets.isPending ? undefined : (counts?.hold["true"] ?? 0)} />
        </div>
      </fieldset>
      {facets.isPending && typeOptions.length === 0 ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        group("Document type", "types", typeOptions, "types")
      )}
      {group(
        "Status",
        "statuses",
        STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s as DocStatus] })),
        "statuses",
      )}
      {group(
        "Sensitivity",
        "sensitivity",
        SENSITIVITIES.map((s) => ({ value: s, label: SENS_LABEL[s] ?? s })),
        "sensitivity",
      )}
      {group(
        "Record",
        "entityTypes",
        ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_LABEL[t] ?? t })),
        undefined,
        (t) => perKind[t],
      )}
    </div>
  );
}

/** A facet's count: "…" while loading; 0 is muted, so the counts that matter stand out. */
function FacetCount({ n }: { n: number | undefined }) {
  return (
    <span
      className={n === 0 ? "type-label-12 text-text-disabled" : "type-label-12 text-text-secondary"}
      aria-label={n === undefined ? "Counting" : `${n} documents`}
    >
      {n === undefined ? "…" : n.toLocaleString("en-GB")}
    </span>
  );
}
