import { BusinessProcess } from "@/components/admin/spec-table";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/erad/button";
import { Checkbox } from "@/components/erad/checkbox";
import { Select } from "@/components/erad/select";
import { SourceTag } from "@/components/admin/source-tag";
import { sectionNotes } from "@/components/admin/spec-notes";
import { specFacts } from "@/components/admin/spec-table";
import { api } from "@/services/api";
import type { ConfigView, EffectiveSpec } from "@/services/tenant-config.functions";
import {
  configChangeBlocker,
  impactText,
  settingSource,
  SPEC_SETTINGS,
  type SpecSetting,
} from "@/services/tenant-rules";

export type Draft = Partial<Record<SpecSetting, string | boolean>>;

const LABEL: Record<SpecSetting, string> = {
  retentionPolicyRef: "Retention policy",
  signatureRequired: "Signature required",
  requiresReview: "Review required",
  containsPersonalData: "Contains personal data",
  defaultSensitivity: "Default sensitivity",
};

export interface SpecPanelProps {
  view: ConfigView;
  spec: EffectiveSpec;
  draft: Draft;
  lockDraft: boolean | undefined;
  readOnly: boolean;
  role: "tenant_admin" | "master_admin";
  onChange: (field: SpecSetting, value: string | boolean) => void;
  onLock: (locked: boolean) => void;
  onReset: () => void;
}

/** Why a setting can't be changed here, or null. Mirrors the server check for instant feedback. */
function blockReason(p: SpecPanelProps, field: SpecSetting): string | null {
  if (p.readOnly) return "Read-only view.";
  const err = configChangeBlocker({
    role: p.role,
    isGroupTenant: p.view.tenant.isGroup,
    specMode: p.view.tenant.inheritance["documentSpecifications"]?.mode,
    locked: p.spec.locked,
    fromGroup: p.spec.definedIn === "master" || p.spec.overridden,
    changes: { [field]: true },
    retentionDays: null,
    floors: {},
    groupName: p.view.tenant.groupName,
  });
  return err ? (err.customerFacing?.detail ?? "Not available here.") : null;
}

export function SpecPanel(p: SpecPanelProps) {
  const { view, spec, draft } = p;
  const value = (f: SpecSetting) => (f in draft ? draft[f] : spec.definition[f]);
  const isGroup = view.tenant.isGroup;
  const usage = useQuery({
    queryKey: ["specUsage", spec.code],
    queryFn: () => api.specUsage(spec.code),
    enabled: isGroup && p.role === "master_admin" && !p.readOnly,
  });

  const notes = sectionNotes(
    SPEC_SETTINGS.map((f) => ({
      source: f in draft ? "changed" : settingSource(specFacts(view, spec), f),
      reason: blockReason(p, f),
    })),
  );
  const control = (f: SpecSetting, i: number) => {
    const reason = blockReason(p, f);
    const v = value(f);
    const own = notes.perField[i] ?? { source: null, reason: null };
    const field =
      f === "requiresReview" || f === "containsPersonalData" ? (
        <Checkbox
          label={LABEL[f]}
          checked={v === true}
          aria-disabled={reason ? true : undefined}
          onCheckedChange={(c) => {
            if (!reason) p.onChange(f, c === true);
          }}
        />
      ) : f === "retentionPolicyRef" ? (
        <Select
          label={LABEL[f]}
          unavailable={!!reason}
          value={typeof v === "string" ? v : ""}
          placeholder="Not set"
          groups={[
            {
              options: view.retention.map((r) => ({
                value: r.id,
                label: r.name,
                disabled: !!reason,
              })),
            },
          ]}
          onValueChange={(nv) => {
            if (!reason) p.onChange(f, nv);
          }}
        />
      ) : (
        <Select
          label={LABEL[f]}
          unavailable={!!reason}
          value={typeof v === "string" ? v : "none"}
          groups={[
            {
              options: (f === "signatureRequired"
                ? ["none", "simple", "advanced", "qualified"]
                : ["public", "internal", "confidential", "restricted"]
              ).map((o) => ({
                value: o,
                label: o[0]?.toUpperCase() + o.slice(1),
                disabled: !!reason,
              })),
            },
          ]}
          onValueChange={(nv) => {
            if (!reason) p.onChange(f, nv);
          }}
        />
      );
    return (
      <li key={f} className="flex flex-col gap-1 border-b border-border-subtle pb-4">
        {field}
        {own.source || own.reason ? (
          <div className="flex flex-wrap items-center gap-2">
            {own.source ? <SourceTag source={own.source} /> : null}
            {own.reason ? (
              <span className="type-label-12 text-text-secondary">{own.reason}</span>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="type-title-16-medium">{spec.name}</h3>
        <code className="type-label-12 text-text-secondary">{spec.code}</code>
      </div>
      {notes.source || notes.reason ? (
        <div className="flex flex-col items-start gap-1">
          {notes.source ? <SourceTag source={notes.source} /> : null}
          {notes.reason ? (
            <p className="type-paragraph-14 text-text-secondary">
              {/* The tag already says Locked; the sentence says who set it. */}
              {notes.source === "locked"
                ? `Set by ${view.tenant.groupName}. Countries cannot change it.`
                : notes.reason}
            </p>
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-4">{SPEC_SETTINGS.map(control)}</ul>
      <BusinessProcess spec={spec} />
      {isGroup && !p.readOnly ? (
        <div className="flex flex-col gap-2">
          <Checkbox
            label="Lock for every country"
            checked={p.lockDraft ?? spec.locked}
            onCheckedChange={(c) => p.onLock(c === true)}
          />
          {usage.data ? (
            <p className="type-paragraph-14 text-text-secondary">
              {impactText(usage.data.children, usage.data.overridden)}
            </p>
          ) : null}
        </div>
      ) : null}
      {!isGroup && spec.overridden && !p.readOnly ? (
        <Button onClick={p.onReset}>Reset to group</Button>
      ) : null}
    </div>
  );
}
