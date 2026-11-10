import { format } from "date-fns";
import { Lock } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Checkbox } from "@/components/erad/checkbox";
import { Tag } from "@/components/erad/tag";
import { STATUS_LABEL, STATUS_TONE, typeLabel } from "@/lib/document-labels";
import { cn } from "@/lib/utils";
import type { SearchRow } from "@/services/search.functions";

const ROW_H = 56;
const OVERSCAN = 8;

export interface ResultsTableProps {
  rows: SearchRow[];
  activeId: string | undefined;
  onOpen: (id: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Only the rows in view are drawn, so tens of thousands of loaded rows stay smooth.
 * Arrow keys move, Enter opens, Space ticks. More rows load when you near the end.
 */
export function ResultsTable(p: ResultsTableProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(640);
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(p.rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);

  useEffect(() => {
    if (p.hasMore && !p.loadingMore && end >= p.rows.length - 10) p.onLoadMore();
  }, [end, p]);

  const moveTo = (i: number) => {
    const n = Math.max(0, Math.min(p.rows.length - 1, i));
    setFocus(n);
    const el = scroller.current;
    if (el) {
      const top = n * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    }
    requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-row="${n}"]`)?.focus());
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = p.rows[focus];
    if (e.key === "ArrowDown") { e.preventDefault(); moveTo(focus + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveTo(focus - 1); }
    else if (e.key === "Home") { e.preventDefault(); moveTo(0); }
    else if (e.key === "End") { e.preventDefault(); moveTo(p.rows.length - 1); }
    else if (e.key === "Enter" && row) { e.preventDefault(); p.onOpen(row.id); }
    else if (e.key === " " && row && (e.target as HTMLElement).dataset["row"] !== undefined) { e.preventDefault(); p.onToggle(row.id); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border-subtle">
      <div className="type-label-12 flex h-9 items-center gap-3 border-b border-border-subtle px-3 text-text-secondary" role="presentation">
        <Checkbox aria-label="Select all loaded documents" checked={p.allSelected} onCheckedChange={p.onToggleAll} />
        <span className="flex-1">Name</span>
        <span className="hidden w-48 lg:block">Record</span>
        <span className="w-28">Status</span>
        <span className="hidden w-28 md:block">Changed</span>
      </div>
      <div
        ref={scroller}
        role="grid"
        aria-label="Documents"
        aria-rowcount={p.hasMore ? -1 : p.rows.length}
        className="relative min-h-0 flex-1 overflow-auto"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onKey}
      >
        <div style={{ height: p.rows.length * ROW_H }} className="relative">
          {p.rows.slice(start, end).map((r, k) => {
            const i = start + k;
            const active = r.id === p.activeId;
            return (
              <div
                key={r.id}
                role="row"
                aria-rowindex={i + 1}
                aria-selected={p.selected.has(r.id)}
                data-row={i}
                tabIndex={i === focus ? 0 : -1}
                onFocus={() => setFocus(i)}
                onClick={() => p.onOpen(r.id)}
                style={{ top: i * ROW_H, height: ROW_H }}
                className={cn(
                  "focus-ring absolute inset-x-0 flex cursor-pointer items-center gap-3 border-b border-border-subtle px-3 hover:bg-item-hover",
                  active && "bg-item-selected",
                )}
              >
                <span role="gridcell" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`Select ${r.name}`} tabIndex={-1} checked={p.selected.has(r.id)} onCheckedChange={() => p.onToggle(r.id)} />
                </span>
                <span role="gridcell" className="flex min-w-0 flex-1 flex-col">
                  <span className="type-label-14 truncate">{r.name}</span>
                  <span className={cn("type-label-12 truncate", !active && "text-text-secondary")}>
                    {typeLabel(r.document_type)}
                    {r.pending > 0 ? ` · ${r.pending} to check` : ""}
                  </span>
                </span>
                <span role="gridcell" className={cn("type-label-12 hidden w-48 truncate lg:block", !active && "text-text-secondary")}>
                  {r.entity_name ?? (r.entity_id ? "Record you can't open" : "—")}
                </span>
                <span role="gridcell" className="flex w-28 items-center gap-1">
                  <Tag tone={STATUS_TONE[r.status]} small>{STATUS_LABEL[r.status]}</Tag>
                  {r.legal_hold ? <Lock aria-label="On legal hold" className="size-4 shrink-0" /> : null}
                </span>
                <span role="gridcell" className={cn("type-label-12 hidden w-28 md:block", !active && "text-text-secondary")}>
                  {format(new Date(r.updated_at), "d MMM yyyy")}
                </span>
              </div>
            );
          })}
        </div>
        {p.loadingMore ? <p className="type-label-12 p-3 text-text-secondary" role="status">Loading more…</p> : null}
        {!p.hasMore && p.rows.length > 0 ? <p className="type-label-12 p-3 text-text-secondary">That's everything for this search.</p> : null}
      </div>
    </div>
  );
}
