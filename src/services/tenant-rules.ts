// Pure rules for shared configuration between the group (master) and its countries (children).
import { seamError, type AppRole, type SeamError } from "@/services/document-rules";

export type InheritMode = "inherit" | "extend" | "override" | "locked";

/** Settings of a document type that a country may change, in display order. */
export const SPEC_SETTINGS = [
  "retentionPolicyRef",
  "signatureRequired",
  "requiresReview",
  "containsPersonalData",
  "defaultSensitivity",
] as const;
export type SpecSetting = (typeof SPEC_SETTINGS)[number];

export type SettingSource = "inherited" | "changed" | "locked" | "own";

export interface EffectiveSpecFacts {
  locked: boolean;
  definedIn: string | null; // "master" | "tenant"
  overriddenFields: string[] | null;
  isGroupTenant: boolean;
}

/** Where a setting comes from, read from effective_specifications. */
export function settingSource(row: EffectiveSpecFacts, field?: string): SettingSource {
  if (row.isGroupTenant) return "own";
  if (row.locked) return "locked";
  // A country-only type has no group original: nothing is inherited.
  if (row.definedIn === "tenant" && (row.overriddenFields ?? []).length === 0) return "own";
  if (field === undefined) return row.overriddenFields && row.overriddenFields.length > 0 ? "changed" : "inherited";
  return row.overriddenFields?.includes(field) ? "changed" : "inherited";
}

export function sourceLabel(source: SettingSource, groupName: string): string {
  switch (source) {
    case "inherited":
      return `From ${groupName}`;
    case "changed":
      return "Changed here";
    case "locked":
      return `Locked by ${groupName}`;
    case "own":
      return "Added here";
  }
}

/** One sentence describing how this country relates to the group's setting. */
export function relationSentence(mode: InheritMode | undefined): string {
  switch (mode) {
    case "extend":
      return "Adds its own";
    case "override":
      return "Replaces the group's";
    case "locked":
      return "Locked by the group";
    default:
      return "Uses the group's setting";
  }
}

export interface HardFloors {
  minRetentionDays?: number;
  autoAcceptConfidenceAtLeast?: number;
  requireMalwareScan?: boolean;
}

export function yearsLabel(days: number): string {
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? "year" : "years"}`;
}

export interface ChangeFacts {
  role: AppRole;
  isGroupTenant: boolean;
  specMode: InheritMode | undefined;
  /** True when the group locked this type. */
  locked: boolean;
  /** True when the type exists at group level (an override, not a new type). */
  fromGroup: boolean;
  changes: Partial<Record<SpecSetting, unknown>>;
  retentionDays: number | null; // of the chosen retention policy, if changed
  floors: HardFloors;
  groupName: string;
}

/** Returns why a configuration change is refused, or null when allowed. Enforced on the server too. */
export function configChangeBlocker(f: ChangeFacts): SeamError | null {
  const isAdmin = f.role === "tenant_admin" || f.role === "master_admin";
  if (!isAdmin) return seamError("access.roleTooLow", "rejected", "contactSupport");
  if (!f.isGroupTenant) {
    if (f.locked) return seamError("config.locked", "rejected", "none", `Locked by ${f.groupName}.`);
    if (f.specMode === "locked" || f.specMode === "inherit") {
      return seamError("config.locked", "rejected", "none", `Document types are set by ${f.groupName}.`);
    }
    if (f.fromGroup && f.specMode === "extend") {
      const onlyAdditive = Object.keys(f.changes).every((k) => k === "containsPersonalData" || k === "requiresReview");
      if (!onlyAdditive) {
        return seamError("config.extendOnly", "rejected", "none", `${f.groupName} lets this organisation add to its types, not replace their settings.`);
      }
    }
  }
  if (f.retentionDays !== null && f.floors.minRetentionDays && f.retentionDays < f.floors.minRetentionDays) {
    return seamError(
      "config.belowFloor",
      "validation",
      "fixInput",
      `Retention cannot be shorter than ${yearsLabel(f.floors.minRetentionDays)}. Set by ${f.groupName}.`,
    );
  }
  return null;
}

/** "Applies to 2 tenants. 1 tenant has overridden this and keeps its version." */
export function impactText(childCount: number, overriddenCount: number): string {
  const t = (n: number) => `${n} ${n === 1 ? "tenant" : "tenants"}`;
  const base = `Applies to ${t(childCount)}.`;
  if (overriddenCount === 0) return base;
  return `${base} ${t(overriddenCount)} ${overriddenCount === 1 ? "has" : "have"} overridden this and ${overriddenCount === 1 ? "keeps its" : "keep their"} version.`;
}

/** Effective retention: the group minimum raises a shorter local policy. */
export function effectiveRetentionDays(policyDays: number, floors: HardFloors): { days: number; raised: boolean } {
  const min = floors.minRetentionDays ?? 0;
  return policyDays < min ? { days: min, raised: true } : { days: policyDays, raised: false };
}
