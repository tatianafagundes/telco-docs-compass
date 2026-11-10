import type { ReactNode } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Info,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type TagTone =
  | "critical"
  | "major"
  | "minor"
  | "warning"
  | "cleared"
  | "indeterminate"
  | "purple";

const TONE_CLASS: Record<TagTone, string> = {
  critical: "[--tone:var(--status-critical)]",
  major: "[--tone:var(--status-major)]",
  minor: "[--tone:var(--status-minor)]",
  warning: "[--tone:var(--status-warning)]",
  cleared: "[--tone:var(--status-cleared)]",
  indeterminate: "[--tone:var(--status-indeterminate)]",
  purple: "[--tone:var(--status-purple)]",
};

const TONE_ICON: Record<TagTone, typeof Info> = {
  critical: AlertOctagon,
  major: AlertTriangle,
  minor: AlertTriangle,
  warning: Info,
  cleared: CheckCircle2,
  indeterminate: CircleDashed,
  purple: Sparkles,
};

export interface TagProps {
  tone?: TagTone;
  /** The status word – colour never carries meaning alone. */
  children: ReactNode;
  icon?: ReactNode | false;
  small?: boolean;
  className?: string;
}

export function Tag({ tone = "indeterminate", children, icon, small, className }: TagProps) {
  const Icon = tone === "critical" && icon === undefined ? ShieldAlert : TONE_ICON[tone];
  return (
    <span
      className={cn(
        "tag-tone inline-flex items-center gap-1 text-text-main",
        TONE_CLASS[tone],
        small ? "type-label-12 h-4 rounded-[3px] px-1" : "type-label-14 h-6 rounded-badge px-2",
        className,
      )}
    >
      {icon === false || small ? null : (icon ?? <Icon aria-hidden="true" className="size-4 shrink-0" />)}
      {children}
    </span>
  );
}
