import { Card } from "@/components/erad/card";
import type { TenantInfo } from "@/services/tenant-config.functions";
import { relationSentence, yearsLabel } from "@/services/tenant-rules";

/**
 * Each card says what the policy decides, how this country relates to the group's setting, and
 * the value when the group has set one. The group is named once, above the cards.
 */
const CARDS: {
  title: string;
  key: string;
  /** What the policy decides, so a card never shows a mode without a meaning. */
  covers: string;
  note?: (t: TenantInfo) => string | null;
}[] = [
  {
    title: "Retention",
    key: "retentionPolicies",
    covers: "How long each document type is kept.",
    note: (t) =>
      t.floors.minRetentionDays ? `At least ${yearsLabel(t.floors.minRetentionDays)}.` : null,
  },
  {
    title: "Sensitivity labels",
    key: "sensitivityLabels",
    covers: "The labels a document can carry: public, internal, confidential, restricted.",
  },
  { title: "Access roles", key: "binding", covers: "Which roles can view, change and approve." },
  {
    title: "Confidence levels",
    key: "extractionThresholds",
    covers: "When a detail read from a file is accepted without a person checking it.",
    note: (t) =>
      t.floors.autoAcceptConfidenceAtLeast
        ? `Automatic acceptance needs at least ${Math.round(t.floors.autoAcceptConfidenceAtLeast * 100)}% confidence.`
        : null,
  },
  {
    title: "Approval steps",
    key: "statusWorkflow",
    covers: "The status path from draft to approved, effective and archived.",
  },
  {
    title: "Where files are stored",
    key: "storage",
    covers: "Where files are kept and how they are checked.",
    note: (t) =>
      t.floors.requireMalwareScan ? "Every file is scanned before anyone can open it." : null,
  },
];

export function PolicyCards({ tenant }: { tenant: TenantInfo }) {
  return (
    <div className="flex flex-col gap-2">
      {tenant.isGroup ? null : (
        <p className="type-paragraph-14 text-text-secondary">
          {`The group's settings come from ${tenant.groupName}.`}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(324px,1fr))] gap-4">
        {CARDS.map((c) => {
          const sentence = tenant.isGroup
            ? "Set here for the whole group"
            : relationSentence(tenant.inheritance[c.key]?.mode);
          const note = c.note?.(tenant);
          return (
            <Card key={c.key} title={c.title}>
              <p className="type-paragraph-14 text-text-secondary">{c.covers}</p>
              <p className="type-label-14-medium">{sentence}</p>
              {note ? <p className="type-paragraph-14">{note}</p> : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
