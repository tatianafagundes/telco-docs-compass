import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CardProps {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  className?: string;
}

export function Card({ title, children, actions, selected, className }: CardProps) {
  return (
    <section
      className={cn(
        "flex min-w-[324px] flex-col gap-4 border p-2",
        selected ? "border-border-selected" : "border-border-item",
        className,
      )}
    >
      {title ? <h3 className="type-title-16-medium">{title}</h3> : null}
      <div className="type-paragraph-14">{children}</div>
      {actions ? <div className="flex justify-end gap-2">{actions}</div> : null}
    </section>
  );
}
