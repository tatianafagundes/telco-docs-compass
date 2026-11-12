import { describe, expect, it } from "vitest";
import {
  configChangeBlocker,
  effectiveRetentionDays,
  impactText,
  relationSentence,
  settingSource,
  sourceLabel,
  type ChangeFacts,
} from "@/services/tenant-rules";

const GROUP = "Aurora Telecom Group";
const base: ChangeFacts = {
  role: "tenant_admin",
  isGroupTenant: false,
  specMode: "override",
  locked: false,
  fromGroup: true,
  changes: { retentionPolicyRef: "ret-commercial" },
  retentionDays: 2555,
  floors: { minRetentionDays: 1825 },
  groupName: GROUP,
};

describe("tenant-rules", () => {
  it("should label sources with the real organisation name", () => {
    expect(sourceLabel("inherited", GROUP)).toBe("From Aurora Telecom Group");
    expect(sourceLabel("locked", GROUP)).toBe("Locked by Aurora Telecom Group");
    expect(sourceLabel("changed", GROUP)).toBe("Changed here");
  });

  it("should read changed fields from overridden_fields", () => {
    const row = { locked: false, definedIn: "tenant", overriddenFields: ["specCharacteristic"], isGroupTenant: false };
    expect(settingSource(row, "specCharacteristic")).toBe("changed");
    expect(settingSource(row, "requiresReview")).toBe("inherited");
    expect(settingSource({ ...row, locked: true }, "requiresReview")).toBe("locked");
  });

  it("should reject retention below the group floor with a sentence naming it", () => {
    const err = configChangeBlocker({ ...base, retentionDays: 365 });
    expect(err?.code).toBe("config.belowFloor");
    expect(err?.customerFacing?.detail).toBe("Retention cannot be shorter than 5 years. Set by Aurora Telecom Group.");
  });

  it("should reject changes to a locked type", () => {
    expect(configChangeBlocker({ ...base, locked: true })?.code).toBe("config.locked");
  });

  it("should reject changes from roles below admin", () => {
    expect(configChangeBlocker({ ...base, role: "manager" })?.code).toBe("access.roleTooLow");
  });

  it("should allow only additive changes in extend mode", () => {
    expect(configChangeBlocker({ ...base, specMode: "extend" })?.code).toBe("config.extendOnly");
    expect(configChangeBlocker({ ...base, specMode: "extend", changes: { containsPersonalData: true }, retentionDays: null })).toBeNull();
  });

  it("should allow a valid override", () => {
    expect(configChangeBlocker(base)).toBeNull();
  });

  it("should describe impact on children", () => {
    expect(impactText(2, 1)).toBe("Applies to 2 tenants. 1 tenant has overridden this and keeps its version.");
    expect(impactText(2, 0)).toBe("Applies to 2 tenants.");
  });

  it("should raise a shorter local retention to the group minimum", () => {
    expect(effectiveRetentionDays(1095, { minRetentionDays: 2190 })).toEqual({ days: 2190, raised: true });
  });

  it("should describe inheritance modes in one sentence", () => {
    expect(relationSentence("inherit")).toBe("Uses the group's setting");
    expect(relationSentence("locked")).toBe("Locked by the group");
  });
});

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
import { yearsLabel } from "@/services/tenant-rules";

describe("BR-055 effective retention", () => {
  it("BR-055 max(policy days, group minimum) with a raised flag only when the floor applies", () => {
    expect(effectiveRetentionDays(2555, { minRetentionDays: 1825 })).toEqual({ days: 2555, raised: false });
    expect(effectiveRetentionDays(1825, { minRetentionDays: 1825 })).toEqual({ days: 1825, raised: false });
    expect(effectiveRetentionDays(365, {})).toEqual({ days: 365, raised: false });
  });
});

describe("BR-080/BR-081/BR-082/BR-083 configuration change blockers", () => {
  it("BR-080 only tenant_admin or master_admin may change configuration", () => {
    for (const role of ["viewer", "contributor", "reviewer", "manager"] as const) {
      expect(configChangeBlocker({ ...base, role })?.code).toBe("access.roleTooLow");
    }
    expect(configChangeBlocker({ ...base, role: "master_admin", isGroupTenant: true })).toBeNull();
  });
  it("BR-081 a locked type, or a locked/inherit area, is refused with the group named", () => {
    const locked = configChangeBlocker({ ...base, locked: true });
    expect(locked?.code).toBe("config.locked");
    expect(locked?.customerFacing?.detail).toBe("Locked by Aurora Telecom Group.");
    for (const specMode of ["locked", "inherit"] as const) {
      const err = configChangeBlocker({ ...base, specMode });
      expect(err?.code).toBe("config.locked");
      expect(err?.customerFacing?.detail).toBe("Document types are set by Aurora Telecom Group.");
    }
    expect(configChangeBlocker({ ...base, isGroupTenant: true, locked: true, specMode: "locked" })).toBeNull();
  });
  it("BR-082 extend mode allows containsPersonalData and requiresReview on group types, nothing else", () => {
    expect(configChangeBlocker({ ...base, specMode: "extend", changes: { requiresReview: true, containsPersonalData: false }, retentionDays: null })).toBeNull();
    const err = configChangeBlocker({ ...base, specMode: "extend", changes: { requiresReview: true, defaultSensitivity: "restricted" }, retentionDays: null });
    expect(err?.code).toBe("config.extendOnly");
    expect(err?.customerFacing?.detail).toBe("Aurora Telecom Group lets this organisation add to its types, not replace their settings.");
    expect(configChangeBlocker({ ...base, specMode: "extend", fromGroup: false, changes: { defaultSensitivity: "restricted" }, retentionDays: null })).toBeNull();
  });
  it("BR-083 years = round(days/365), singular for one year, and a retention equal to the floor is allowed", () => {
    expect(yearsLabel(365)).toBe("1 year");
    expect(yearsLabel(400)).toBe("1 year");
    expect(yearsLabel(2190)).toBe("6 years");
    expect(configChangeBlocker({ ...base, retentionDays: 1825 })).toBeNull();
    const err = configChangeBlocker({ ...base, retentionDays: 300, floors: { minRetentionDays: 365 } });
    expect(err?.customerFacing?.detail).toBe("Retention cannot be shorter than 1 year. Set by Aurora Telecom Group.");
  });
});

describe("BR-084/BR-085/BR-086 labels", () => {
  it("BR-084 own settings read 'Added here'", () => {
    expect(sourceLabel("own", GROUP)).toBe("Added here");
    expect(settingSource({ locked: false, definedIn: "tenant", overriddenFields: [], isGroupTenant: false })).toBe("own");
    expect(settingSource({ locked: false, definedIn: "master", overriddenFields: [], isGroupTenant: true })).toBe("own");
    expect(settingSource({ locked: false, definedIn: "master", overriddenFields: null, isGroupTenant: false })).toBe("inherited");
    expect(settingSource({ locked: false, definedIn: "tenant", overriddenFields: ["requiresReview"], isGroupTenant: false })).toBe("changed");
  });
  it("BR-085 relation sentences for extend, override and the default", () => {
    expect(relationSentence("extend")).toBe("Adds its own");
    expect(relationSentence("override")).toBe("Replaces the group's");
    expect(relationSentence(undefined)).toBe("Uses the group's setting");
  });
  it("BR-086 impact text in the plural and for a single tenant", () => {
    expect(impactText(3, 2)).toBe("Applies to 3 tenants. 2 tenants have overridden this and keep their version.");
    expect(impactText(1, 0)).toBe("Applies to 1 tenant.");
    expect(impactText(1, 1)).toBe("Applies to 1 tenant. 1 tenant has overridden this and keeps its version.");
  });
});
