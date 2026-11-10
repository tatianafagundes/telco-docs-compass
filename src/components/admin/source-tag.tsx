import { Lock } from "lucide-react";
import { Tag } from "@/components/erad/tag";
import { sourceLabel, type SettingSource } from "@/services/tenant-rules";

/** The one triad used everywhere: From <group> / Changed here / Locked by <group>. */
export function SourceTag({ source, groupName }: { source: SettingSource; groupName: string }) {
  const tone = source === "locked" ? "indeterminate" : source === "changed" ? "warning" : source === "own" ? "purple" : "cleared";
  return (
    <Tag tone={tone} icon={source === "locked" ? <Lock aria-hidden="true" className="size-4" /> : undefined}>
      {sourceLabel(source, groupName)}
    </Tag>
  );
}
