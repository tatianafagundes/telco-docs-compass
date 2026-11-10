import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/erad/checkbox";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
}

export interface DataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowId: (row: T) => string;
  selected?: Set<string>;
  onToggleRow?: (id: string) => void;
  activeId?: string;
  onActivate?: (id: string) => void;
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  rowActions?: (row: T) => ReactNode;
  striped?: boolean;
}

export function DataTable<T>(p: DataTableProps<T>) {
  return (
    <table className="type-label-14 w-full border-collapse">
      <caption className="sr-only">{p.caption}</caption>
      <thead>
        <tr className="h-12 border-b border-border-cell">
          {p.onToggleRow ? <th className="w-10 px-4" scope="col"><span className="sr-only">Select</span></th> : null}
          {p.columns.map((c) => {
            const active = p.sort?.key === c.key;
            const Icon = !active ? ArrowUpDown : p.sort?.dir === "asc" ? ArrowUp : ArrowDown;
            return (
              <th
                key={c.key}
                scope="col"
                aria-sort={active ? (p.sort?.dir === "asc" ? "ascending" : "descending") : undefined}
                className="type-label-14-medium px-4 text-left"
              >
                {c.sortable && p.onSort ? (
                  <button type="button" onClick={() => p.onSort?.(c.key)} className="focus-ring inline-flex items-center gap-1">
                    {c.header}
                    <Icon aria-hidden="true" className="size-4 text-text-secondary" />
                  </button>
                ) : (
                  c.header
                )}
              </th>
            );
          })}
          {p.rowActions ? <th className="px-4" scope="col"><span className="sr-only">Actions</span></th> : null}
        </tr>
      </thead>
      <tbody>
        {p.rows.map((r, i) => {
          const id = p.rowId(r);
          const isSel = p.selected?.has(id) || p.activeId === id;
          return (
            <tr
              key={id}
              aria-selected={isSel || undefined}
              onClick={() => p.onActivate?.(id)}
              className={cn(
                "group h-12 border-b border-border-cell",
                p.striped && i % 2 === 1 && "bg-cell-striped",
                isSel ? "bg-cell-selected shadow-[inset_3px_0_0_var(--color-border-selected)]" : "hover:bg-cell-hover",
                p.onActivate && "cursor-pointer",
              )}
            >
              {p.onToggleRow ? (
                <td className="px-4" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`Select row ${i + 1}`}
                    checked={p.selected?.has(id) ?? false}
                    onCheckedChange={() => p.onToggleRow?.(id)}
                  />
                </td>
              ) : null}
              {p.columns.map((c) => (
                <td key={c.key} className="px-4">{c.cell(r)}</td>
              ))}
              {p.rowActions ? (
                <td className="px-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    {p.rowActions(r)}
                  </div>
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
