// Documents page search state, kept in the page address so views can be bookmarked and shared.
import { normaliseFilters, SENSITIVITIES, SORTS, STATUSES, type SearchFilters, type SortKey } from "@/services/search-rules";
import type { DocStatus } from "@/schemas/document";

export interface DocumentsSearch extends SearchFilters {
  doc?: string;
  /** Shows the results list even without filters ("See all"). */
  all?: boolean;
}

const strArr = (v: unknown, max = 30): string[] | undefined => {
  const arr = Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
  const out = arr.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64).slice(0, max);
  return out.length ? out : undefined;
};
const bool = (v: unknown) => (v === true || v === "true" ? true : undefined);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** Lenient: unknown values are dropped rather than replacing the whole search. */
export function parseDocumentsSearch(raw: Record<string, unknown>): DocumentsSearch {
  const out: DocumentsSearch = {};
  if (typeof raw["q"] === "string" && raw["q"].trim()) out.q = raw["q"].slice(0, 200);
  const types = strArr(raw["types"]);
  if (types) out.types = types;
  const statuses = strArr(raw["statuses"])?.filter((s): s is DocStatus => (STATUSES as string[]).includes(s));
  if (statuses?.length) out.statuses = statuses;
  const sens = strArr(raw["sensitivity"])?.filter((s): s is (typeof SENSITIVITIES)[number] => (SENSITIVITIES as readonly string[]).includes(s));
  if (sens?.length) out.sensitivity = sens;
  const et = strArr(raw["entityTypes"], 10);
  if (et) out.entityTypes = et;
  if (typeof raw["entityId"] === "string" && raw["entityId"].length <= 64 && raw["entityId"]) out.entityId = raw["entityId"];
  if (bool(raw["hold"])) out.hold = true;
  if (bool(raw["review"])) out.review = true;
  const exp = date(raw["expiringBefore"]);
  if (exp) out.expiringBefore = exp;
  if (typeof raw["sort"] === "string" && (SORTS as readonly string[]).includes(raw["sort"])) out.sort = raw["sort"] as SortKey;
  if (typeof raw["doc"] === "string" && /^[0-9a-f-]{36}$/i.test(raw["doc"])) out.doc = raw["doc"];
  if (bool(raw["all"])) out.all = true;
  return out;
}

export function filtersOf(s: DocumentsSearch): SearchFilters {
  const { doc: _doc, all: _all, ...f } = s;
  return normaliseFilters(f);
}

export function inDays(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}
