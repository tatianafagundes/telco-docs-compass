import { TextTabs } from "@/components/erad/tabs";
import { DeletionTab } from "@/components/holds/deletion-tab";
import { HoldsTab } from "@/components/holds/holds-tab";
import { RetentionTab } from "@/components/holds/retention-tab";

export function HoldsPage() {
  return (
    <TextTabs
      label="Holds and retention"
      defaultValue="holds"
      tabs={[
        { value: "holds", label: "Holds", content: <HoldsTab /> },
        { value: "retention", label: "Retention", content: <RetentionTab /> },
        { value: "deletions", label: "Deletion history", content: <DeletionTab /> },
      ]}
    />
  );
}
