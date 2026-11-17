import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { masterRetentionFloor } from "@/services/retention-floor";
import { DatabaseError } from "@/services/shared/must";

const db = (tenants: Record<string, unknown>[]) => new FakeDb({ tenants });
describe("masterRetentionFloor", () => {
  it("is the number of days the master tenant sets", async () => {
    const d = db([
      { id: "t", parent_tenant_id: "m" },
      { id: "m", parent_tenant_id: null, hard_floors: { minRetentionDays: 1825 } },
    ]);
    expect(await masterRetentionFloor(d.asDb(), "t")).toBe(1825);
  });
  it.each([
    ["has no master", [{ id: "t", parent_tenant_id: null }]],
    [
      "has a master that sets no floor",
      [
        { id: "t", parent_tenant_id: "m" },
        { id: "m", hard_floors: null },
      ],
    ],
    ["is unknown", []],
  ])("is null when the tenant %s", async (_label, rows) => {
    expect(await masterRetentionFloor(db(rows).asDb(), "t")).toBeNull();
  });
  it("throws instead of answering 'no floor' when the database fails", async () => {
    const d = db([{ id: "t", parent_tenant_id: "m" }]).fail("tenants", "select");
    await expect(masterRetentionFloor(d.asDb(), "t")).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe("masterRetentionFloor with bad data", () => {
  it("throws when the parent points at nothing", async () => {
    await expect(
      masterRetentionFloor(db([{ id: "t", parent_tenant_id: "ghost" }]).asDb(), "t"),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
  it.each([["30"], [-5], [1.5], [true]])("throws for a floor of %j", async (bad) => {
    const d = db([
      { id: "t", parent_tenant_id: "m" },
      { id: "m", hard_floors: { minRetentionDays: bad } },
    ]);
    await expect(masterRetentionFloor(d.asDb(), "t")).rejects.toBeInstanceOf(DatabaseError);
  });
  it("accepts zero as no floor", async () => {
    const d = db([
      { id: "t", parent_tenant_id: "m" },
      { id: "m", hard_floors: { minRetentionDays: 0 } },
    ]);
    expect(await masterRetentionFloor(d.asDb(), "t")).toBe(0);
  });
});
