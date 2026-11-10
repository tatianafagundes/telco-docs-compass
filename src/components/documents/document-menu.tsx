import { MoreHorizontal } from "lucide-react";
import { Fragment } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  /** When set, the entry is unavailable and this reason is shown under it. */
  reason?: string | undefined;
  destructive?: boolean;
  separatorBefore?: boolean;
}

/** "…" menu for less frequent document actions. Unavailable entries stay focusable and show their reason. */
export function DocumentMenu({ entries }: { entries: MenuEntry[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="More actions"
        className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-control text-text-main hover:bg-item-hover"
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-card border border-border-subtle bg-layer-content p-1 text-text-main">
        {entries.map((e) => (
          <Fragment key={e.label}>
            {e.separatorBefore ? <DropdownMenuSeparator className="bg-border-subtle" /> : null}
            <DropdownMenuItem
              aria-disabled={e.reason ? true : undefined}
              onSelect={(ev) => {
                if (e.reason) {
                  ev.preventDefault();
                  return;
                }
                e.onSelect();
              }}
              className={cn(
                "flex min-h-8 cursor-pointer flex-col items-start gap-0 rounded-control px-2 py-1.5 focus:bg-item-hover",
                e.reason && "cursor-not-allowed",
              )}
            >
              <span className={cn("type-label-14", e.reason ? "text-text-disabled" : e.destructive ? "text-status-critical" : "")}>{e.label}</span>
              {e.reason ? <span className="type-label-12 text-text-secondary">{e.reason}</span> : null}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
