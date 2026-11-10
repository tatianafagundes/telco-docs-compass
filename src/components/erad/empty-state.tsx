import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  cause: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, cause, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <Icon aria-hidden="true" className="size-6 text-text-secondary" />
      <h3 className="type-title-16-medium">{title}</h3>
      <p className="type-paragraph-14 max-w-[420px] text-text-secondary">{cause}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
