import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PillProps {
  label: string;
  selected?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}

export function Pill({ label, selected = true, onToggle, onRemove, removeLabel }: PillProps) {
  return (
    <span
      className={cn(
        "type-label-14 inline-flex h-6 items-center gap-1 rounded-pill border px-2",
        selected
          ? "border-border-item text-text-main hover:bg-item-hover"
          : "border-border-item text-text-secondary hover:border-border-item-hover hover:text-text-main",
      )}
    >
      <button
        type="button"
        aria-pressed={onToggle ? selected : undefined}
        onClick={onToggle}
        className="focus-ring rounded-pill"
      >
        {label}
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? `Remove ${label}`}
          className="focus-ring -mr-1 flex size-6 items-center justify-center rounded-pill"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </span>
  );
}
