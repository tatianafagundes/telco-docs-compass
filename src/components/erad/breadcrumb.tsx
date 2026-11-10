import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface BreadcrumbItem {
  label: string;
  render?: (label: string) => ReactNode;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="type-label-14 flex items-center gap-1">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${it.label}-${i}`} className="flex items-center gap-1">
              {last ? (
                <span aria-current="page">{it.label}</span>
              ) : (
                <span className="text-text-link">{it.render ? it.render(it.label) : it.label}</span>
              )}
              {last ? null : <ChevronRight aria-hidden="true" className="size-4 text-text-secondary" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
