import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Divider({ vertical, className }: { vertical?: boolean; className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(vertical ? "w-px self-stretch" : "h-px w-full", "bg-border-subtle", className)}
    />
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1 text-text-secondary">
      <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("h-4 animate-pulse bg-item-hover motion-reduce:animate-none", className)}
    />
  );
}

export function SkeletonRow({ columns = 5 }: { columns?: number }) {
  return (
    <div aria-hidden="true" className="flex h-12 items-center gap-4 border-b border-border-cell px-4">
      {Array.from({ length: columns }, (_, i) => (
        <Skeleton key={i} className={i === 0 ? "w-48" : "w-20"} />
      ))}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1 w-full bg-border-subtle"
    >
      <div className="h-1 bg-item-selected" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s|\./)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className="type-label-12 flex size-6 items-center justify-center rounded-full bg-item-selected text-text-on-primary"
    >
      {initials}
    </span>
  );
}
