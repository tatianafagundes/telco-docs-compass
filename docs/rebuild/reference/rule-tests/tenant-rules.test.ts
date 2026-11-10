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
