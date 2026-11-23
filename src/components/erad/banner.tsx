import type { ReactNode } from "react";
import { Tag, type TagTone } from "@/components/erad/tag";
/** Tones that mean something went or may go wrong: their tag carries the EDS severity icon. */
const SEVERITY: ReadonlySet<TagTone> = new Set(["critical", "major", "minor", "warning"]);
export type BannerProps = {
  status: string;
  children: ReactNode;
  action?: ReactNode;
} & (
  | { tone: TagTone; icon?: never }
  /** No tone: a default gray tag, which may carry an icon (for example Read-only). */
  | { tone?: undefined; icon?: ReactNode }
);
export function Banner({ tone, icon, status, children, action }: BannerProps) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-border-item p-3"
    >
      {tone ? (
        <Tag tone={tone} severity={SEVERITY.has(tone)}>
          {status}
        </Tag>
      ) : (
        <Tag icon={icon}>{status}</Tag>
      )}
      <div className="type-paragraph-14 min-w-[12rem] flex-1">{children}</div>
      {action}
    </div>
  );
}
