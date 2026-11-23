import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageItems, pageRange } from "@/lib/table-format";
import { cn } from "@/lib/utils";
export interface PaginationProps {
  /** 0-based. */
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** What is being paged, for the navigation's name, e.g. "documents". */
  label: string;
}
/**
 * EDS pagination: previous and next icons, the page numbers with an ellipsis, the current page
 * marked by a bottom border, and the range with the total.
 */
export function Pagination({ page, pageSize, total, onPage, label }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const cell =
    "focus-ring type-label-14 inline-flex h-8 min-w-8 items-center justify-center px-2 hover:bg-item-hover";
  return (
    <nav aria-label={`Pages of ${label}`} className="flex flex-wrap items-center gap-3">
      <span className="type-label-14 text-text-secondary">{pageRange(page, pageSize, total)}</span>
      <ul className="flex items-center gap-1">
        <li>
          <button
            type="button"
            className={cn(
              cell,
              "aria-disabled:cursor-not-allowed aria-disabled:text-text-disabled",
            )}
            aria-label="Previous page"
            aria-disabled={page === 0 || undefined}
            onClick={() => page > 0 && onPage(page - 1)}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
        </li>
        {pageItems(page, pages).map((p, i) =>
          p === "…" ? (
            <li
              key={`gap-${i}`}
              aria-hidden="true"
              className="type-label-14 px-1 text-text-secondary"
            >
              …
            </li>
          ) : (
            <li key={p}>
              <button
                type="button"
                className={cn(cell, p === page && "border-b-2 border-border-selected")}
                aria-label={`Page ${p + 1}`}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPage(p)}
              >
                {p + 1}
              </button>
            </li>
          ),
        )}
        <li>
          <button
            type="button"
            className={cn(
              cell,
              "aria-disabled:cursor-not-allowed aria-disabled:text-text-disabled",
            )}
            aria-label="Next page"
            aria-disabled={page >= pages - 1 || undefined}
            onClick={() => page < pages - 1 && onPage(page + 1)}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </li>
      </ul>
    </nav>
  );
}
