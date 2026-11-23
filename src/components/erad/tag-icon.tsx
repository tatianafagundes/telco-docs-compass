import type { ReactNode } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Info } from "lucide-react";
import { cn } from "@/lib/utils";
export type TagTone =
  "critical" | "major" | "minor" | "warning" | "cleared" | "indeterminate" | "purple";
/** The EDS severity icons. Only severity tags carry an icon among the coloured tags. */
const SEVERITY_ICON: Partial<Record<TagTone, typeof Info>> = {
  critical: AlertOctagon,
  major: AlertTriangle,
  minor: AlertTriangle,
  warning: Info,
  cleared: CheckCircle2,
  indeterminate: CircleDashed,
};
/** Which icon a tag shows, or null. Exported for the tests. */
export function tagIcon(p: {
  tone?: TagTone | undefined;
  icon?: ReactNode;
  severity?: boolean | undefined;
  small?: boolean | undefined;
}): ReactNode {
  if (p.tone === undefined) return p.small ? null : (p.icon ?? null);
  if (!p.severity) return null;
  const Icon = SEVERITY_ICON[p.tone];
  return Icon ? (
    <Icon aria-hidden="true" className={cn("shrink-0", p.small ? "size-3.5" : "size-4")} />
  ) : null;
}
