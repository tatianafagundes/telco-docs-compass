// Order of the documents table on a record page. Pure, no React.
export type RecordSortKey = "name" | "type" | "changed";
export interface RecordSort {
  key: RecordSortKey;
  dir: "asc" | "desc";
}
export const DEFAULT_RECORD_SORT: RecordSort = { key: "changed", dir: "desc" };
interface Sortable {
  name: string;
  document_type?: string | null;
  updated_at?: string | null;
}
/** Sorted copy; ties keep the name order so the list never jumps. */
export function sortRecordDocs<T extends Sortable>(
  items: readonly T[],
  sort: RecordSort,
  typeName: (code: string) => string,
): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const value = (d: T) =>
    sort.key === "name"
      ? d.name
      : sort.key === "type"
        ? typeName(d.document_type ?? "")
        : (d.updated_at ?? "");
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => sign * value(a).localeCompare(value(b)) || byName(a, b));
}
/** Clicking a header: the same column flips, a new column starts in its natural order. */
export function nextRecordSort(current: RecordSort, key: RecordSortKey): RecordSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "changed" ? "desc" : "asc" };
}
