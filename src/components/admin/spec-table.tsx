import { DataTable, type Column } from "@/components/erad/data-table";
import { Tooltip } from "@/components/erad/tooltip";
import { SourceTag } from "@/components/admin/source-tag";
import type { ConfigView, EffectiveSpec } from "@/services/tenant-config.functions";
import { settingSource } from "@/services/tenant-rules";

interface Process {
  id?: string;
  name?: string;
  release?: string;
  framework?: string;
}

export function specFacts(view: ConfigView, s: EffectiveSpec) {
  return { locked: s.locked, definedIn: s.definedIn, overriddenFields: s.overriddenFields, isGroupTenant: view.tenant.isGroup };
}

function yesNo(v: unknown): string {
  return v === true ? "Yes" : "No";
}

export function SpecTable({ view, activeCode, onOpen }: { view: ConfigView; activeCode?: string; onOpen: (code: string) => void }) {
  const retention = new Map(view.retention.map((r) => [r.id, r.name]));
  const columns: Column<EffectiveSpec>[] = [
    { key: "name", header: "Name", cell: (s) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(s.code); }} className="focus-ring type-label-14-medium text-left underline-offset-2 hover:underline">
          {s.name}
        </button>
      ) },
    { key: "where", header: "Where defined", cell: (s) => <SourceTag source={settingSource(specFacts(view, s))} groupName={view.tenant.groupName} /> },
    { key: "retention", header: "Retention", cell: (s) => retention.get(String(s.definition["retentionPolicyRef"] ?? "")) ?? "Not set" },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable
        caption="Document types"
        columns={columns}
        rows={view.specs}
        rowId={(s) => s.code}
        {...(activeCode ? { activeId: activeCode } : {})}
        onActivate={onOpen}
      />
    </div>
  );
}
