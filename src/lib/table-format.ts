// How tables show values, per EDS table styles: ISO 8601 dates (one format per column), an em
// dash for "not set or unknown" (never a blank or a placeholder word), and page numbers with an
// ellipsis for long lists. Pure, no React.
import { format } from "date-fns";
export const tableDate = (iso: string) => format(new Date(iso), "yyyy-MM-dd");
export const tableDateTime = (iso: string) => format(new Date(iso), "yyyy-MM-dd HH:mm");
/** "1–25 of 50": EDS pagination always shows the range and the total. */
export function pageRange(page: number, pageSize: number, total: number): string {
  if (total === 0) return "0 of 0";
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return `${from}–${to} of ${total}`;
}
/**
 * Page numbers to show (0-based), with "…" where pages are left out: the first, the last, and
 * one on each side of the current page. All pages when there are 7 or fewer.
 */
export function pageItems(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const keep = new Set([0, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages));
  if (page <= 2) [1, 2, 3].forEach((p) => keep.add(p));
  if (page >= pages - 3) [pages - 4, pages - 3, pages - 2].forEach((p) => keep.add(p));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - (sorted[i - 1] as number) > 1) out.push("…");
    out.push(p);
  });
  return out;
}
