import { Lock, PenLine } from "lucide-react";
import { Tag } from "@/components/erad/tag";
import { sourceLabel, type SettingSource } from "@/services/tenant-rules";
/**
 * Where a setting comes from: Inherited / Changed here / Locked / Added here.
 * Default gray tags only: colour is kept for document status (green Effective, blue In review), so
 * "where it comes from" never reads as a status. Locked and Changed here carry an icon (EDS lets a
 * large default tag carry one). The group is named once per screen with `sourceNote`.
 */
export function SourceTag({ source }: { source: SettingSource }) {
  const icon =
    source === "locked" ? (
      <Lock aria-hidden="true" className="size-4 shrink-0" />
    ) : source === "changed" ? (
      <PenLine aria-hidden="true" className="size-4 shrink-0" />
    ) : undefined;
  return <Tag icon={icon}>{sourceLabel(source)}</Tag>;
}
