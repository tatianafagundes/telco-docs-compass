import { Card } from "@/components/erad/card";
import type { TenantInfo } from "@/services/tenant-config.functions";
import { relationSentence, yearsLabel } from "@/services/tenant-rules";

const CARDS: { title: string; key: string; note?: (t: TenantInfo) => string | null }[] = [
  { title: "Retention", key: "retentionPolicies", note: (t) => (t.floors.minRetentionDays ? `Minimum ${yearsLabel(t.floors.minRetentionDays)}, set by ${t.groupName}.` : null) },
  { title: "Sensitivity labels", key: "sensitivityLabels" },
  { title: "Access roles", key: "binding" },
  { title: "Confidence levels", key: "extractionThresholds", note: (t) => (t.floors.autoAcceptConfidenceAtLeast ? `Automatic acceptance needs at least ${Math.round(t.floors.autoAcceptConfidenceAtLeast * 100)}% confidence.` : null) },
  { title: "Approval steps", key: "statusWorkflow" },
  { title: "Where files are stored", key: "storage", note: (t) => (t.floors.requireMalwareScan ? "Every file is scanned before anyone can open it." : null) },
];

export function PolicyCards({ tenant }: { tenant: TenantInfo }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(324px,1fr))] gap-4">
      {CARDS.map((c) => {
        const sentence = tenant.isGroup ? "Set here for the whole group" : relationSentence(tenant.inheritance[c.key]?.mode);
        const note = c.note?.(tenant);
        return (
          <Card key={c.key} title={c.title}>
            <p className="type-label-14-medium">{sentence}</p>
            {note ? <p className="text-text-secondary">{note}</p> : null}
          </Card>
        );
      })}
    </div>
  );
}
