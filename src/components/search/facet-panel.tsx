import { Checkbox } from "@/components/erad/checkbox";
import { Skeleton } from "@/components/erad/misc";
import { useFacets } from "@/hooks/use-document-search";
import { STATUS_LABEL, typeLabel } from "@/lib/document-labels";
import type { DocStatus } from "@/schemas/document";
import { ENTITY_TYPES, SENSITIVITIES, STATUSES, type SearchFilters } from "@/services/search-rules";

const SENS_LABEL: Record<string, string> = { public: "Public", internal: "Internal", confidential: "Confidential", restricted: "Restricted" };
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
export function FacetPanel({ filters, onChange }: { filters: SearchFilters; onChange: (f: SearchFilters) => void }) {
  const facets = useFacets(filters);
  const counts = facets.data;

  const group = (title: string, key: ListKey, options: { value: string; label: string }[], countKey?: "types" | "statuses" | "sensitivity") => {
    const selected = (filters[key] as string[] | undefined) ?? [];
    const visible = countKey && counts ? options.filter((o) => (counts[countKey][o.value] ?? 0) > 0 || selected.includes(o.value)) : options;
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="type-label-12 mb-1 text-text-secondary">{title}</legend>
        {visible.length === 0 ? <p className="type-paragraph-14 text-text-secondary">None in these results</p> : null}
        {visible.map((o) => (
          <div key={o.value} className="flex items-center justify-between gap-2">
            <Checkbox label={o.label} checked={selected.includes(o.value)} onCheckedChange={() => onChange({ ...filters, [key]: toggle(selected, o.value) })} />
            {countKey ? (
              <span className="type-label-12 text-text-secondary" aria-label={`${counts?.[countKey][o.value] ?? 0} documents`}>
                {facets.isPending ? "…" : (counts?.[countKey][o.value] ?? 0).toLocaleString("en-GB")}
              </span>
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
      {facets.isError ? <p className="type-paragraph-14 text-text-secondary">Counts aren't available right now. Filters still work.</p> : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="type-label-12 mb-1 text-text-secondary">Needs attention</legend>
        <Checkbox label="Details to check" checked={Boolean(filters.review)} onCheckedChange={(c) => onChange({ ...filters, review: c === true || undefined })} />
        <div className="flex items-center justify-between gap-2">
          <Checkbox label="On legal hold" checked={Boolean(filters.hold)} onCheckedChange={(c) => onChange({ ...filters, hold: c === true || undefined })} />
          <span className="type-label-12 text-text-secondary">{facets.isPending ? "…" : (counts?.hold.true ?? 0).toLocaleString("en-GB")}</span>
        </div>
      </fieldset>
      {facets.isPending && typeOptions.length === 0 ? <Skeleton className="h-24 w-full" /> : group("Document type", "types", typeOptions, "types")}
      {group("Status", "statuses", STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s as DocStatus] })), "statuses")}
      {group("Sensitivity", "sensitivity", SENSITIVITIES.map((s) => ({ value: s, label: SENS_LABEL[s] ?? s })), "sensitivity")}
      {group("Record", "entityTypes", ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_LABEL[t] ?? t })))}
    </div>
  );
}
