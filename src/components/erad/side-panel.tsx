import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SidePanelProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (c: boolean) => void;
  children: ReactNode;
  /** Overlay content instead of squeezing it (narrow viewports / zoom). */
  overlay?: boolean;
}

export function SidePanel({ title, collapsed, onCollapsedChange, children, overlay }: SidePanelProps) {
  return (
    <aside
      aria-label={title}
      className={cn(
        "flex shrink-0 flex-col bg-layer-content shadow-[-1px_0_0_var(--border-item-subtle)]",
        collapsed ? "w-[80px]" : "w-[356px]",
        overlay && "shadow-elev-1 absolute inset-y-0 right-0 z-20",
      )}
    >
      <div className="flex h-12 items-center justify-between gap-2 px-4">
        {collapsed ? null : <h2 className="type-title-16-medium truncate">{title}</h2>}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          onClick={() => onCollapsedChange(!collapsed)}
          className="focus-ring flex size-8 items-center justify-center rounded-control hover:bg-item-hover"
        >
          {collapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
        </button>
      </div>
      {collapsed ? null : <div className="flex-1 overflow-auto p-4">{children}</div>}
    </aside>
  );
}
