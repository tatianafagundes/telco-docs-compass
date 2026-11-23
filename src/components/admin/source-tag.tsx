import { Lock } from "lucide-react";
import { Tag } from "@/components/erad/tag";
import { sourceLabel, type SettingSource } from "@/services/tenant-rules";
/**
 * The one triad used everywhere: Inherited / Changed here / Locked (plus Added here).
 * Locked is a default gray tag with a lock icon; EDS keeps icons off coloured tags.
 * The group is named once per screen with `sourceNote`, not on every tag.
 */
export function SourceTag({ source }: { source: SettingSource }) {
  if (source === "locked")
    return (
      <Tag icon={<Lock aria-hidden="true" className="size-4 shrink-0" />}>
        {sourceLabel(source)}
      </Tag>
    );
  return (
    <Tag tone={source === "changed" ? "warning" : source === "own" ? "purple" : "cleared"}>
      {sourceLabel(source)}
    </Tag>
  );
}
