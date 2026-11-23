import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PolicyCards } from "@/components/admin/policy-cards";
import type { TenantInfo } from "@/services/tenant-config.functions";
const tenant = {
  isGroup: false,
  groupName: "Aurora Telecom Group",
  inheritance: { statusWorkflow: { mode: "locked" } },
  floors: { minRetentionDays: 1825 },
} as unknown as TenantInfo;
describe("PolicyCards", () => {
  it("says what each policy decides, names the group once, and shows set values", () => {
    render(<PolicyCards tenant={tenant} />);
    expect(screen.getAllByText(/Aurora Telecom Group/)).toHaveLength(1);
    expect(screen.getByText("How long each document type is kept.")).toBeTruthy();
    expect(screen.getByText("At least 5 years.")).toBeTruthy();
    expect(screen.getByText("Locked: uses the group's setting")).toBeTruthy();
  });
});
