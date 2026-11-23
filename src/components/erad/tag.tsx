import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { tagIcon, type TagTone } from "@/components/erad/tag-icon";
export type { TagTone } from "@/components/erad/tag-icon";
const TONE_CLASS: Record<TagTone, string> = {
  critical: "[--tone:var(--status-critical)]",
  major: "[--tone:var(--status-major)]",
  minor: "[--tone:var(--status-minor)]",
  warning: "[--tone:var(--status-warning)]",
  cleared: "[--tone:var(--status-cleared)]",
  indeterminate: "[--tone:var(--status-indeterminate)]",
  purple: "[--tone:var(--status-purple)]",
};
interface BaseProps {
  /** The status word – colour never carries meaning alone. Keep it within 20 characters. */
  children: ReactNode;
  small?: boolean;
  className?: string;
}
/**
 * EDS tag. Three kinds, and the types keep them apart:
 * - default (no `tone`): gray, may carry an icon (large only);
 * - coloured (`tone`): no icon;
 * - severity (`tone` + `severity`): the EDS severity icon for that tone, for alerts only.
 */
export type TagProps = BaseProps &
  (
    | { tone?: undefined; icon?: ReactNode; severity?: never }
    | { tone: TagTone; icon?: never; severity?: boolean }
  );
export function Tag(p: TagProps) {
  return (
    <span
      className={cn(
        "tag-tone inline-flex items-center gap-1 whitespace-nowrap text-text-main",
        p.tone ? TONE_CLASS[p.tone] : "[--tone:var(--border-item-idle)]",
        p.small ? "type-label-12 h-4 rounded-[3px] px-1" : "type-label-14 h-6 rounded-badge px-2",
        p.className,
      )}
    >
      {tagIcon(p)}
      {p.children}
    </span>
  );
}
