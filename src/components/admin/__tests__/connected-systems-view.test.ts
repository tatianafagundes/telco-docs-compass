import { describe, expect, it } from "vitest";
import { canLine, splitSystems } from "@/components/admin/connected-systems-view";
import type { ConnectedSystem } from "@/services/integration-clients.functions";
const sys = (name: string, kind: string, revokedAt: string | null = null): ConnectedSystem => ({
  id: name,
  name,
  systemKind: kind,
  keyPrefix: "k",
  scopes: ["read"],
  createdAt: "2026-01-01T00:00:00Z",
  lastUsedAt: null,
  revokedAt,
  expiresAt: null,
  lastRateLimitedAt: null,
  readLimitPerMinute: 120,
  writeLimitPerMinute: 30,
});
const label = (k: string) => ({ crm: "CRM", cpq: "CPQ", orderCare: "Order care" })[k] ?? k;
describe("connected systems list", () => {
  const all = [
    sys("Siebel CRM", "crm"),
    sys("Old CPQ", "cpq", "2026-03-01T00:00:00Z"),
    sys("Amdocs order", "orderCare"),
    sys("Older CPQ", "cpq", "2026-05-01T00:00:00Z"),
  ];
  it("should keep disconnected systems apart, newest first, behind connected ones in name order", () => {
    const { connected, disconnected } = splitSystems(all, "", label);
    expect(connected.map((s) => s.name)).toEqual(["Amdocs order", "Siebel CRM"]);
    expect(disconnected.map((s) => s.name)).toEqual(["Older CPQ", "Old CPQ"]);
  });
  it("should filter by name or by the kind people read", () => {
    expect(splitSystems(all, "order", label).connected.map((s) => s.name)).toEqual([
      "Amdocs order",
    ]);
    expect(splitSystems(all, "cpq", label).disconnected).toHaveLength(2);
    expect(splitSystems(all, "crm", label).connected.map((s) => s.name)).toEqual(["Siebel CRM"]);
  });
  it("should say what a system can do in a few words", () => {
    expect(canLine(["read", "register", "subscribe"])).toBe("Read, Add and edit, Notifications");
  });
});
describe("connected systems screen", () => {
  it("offers Connect a system in the empty state and opens disconnected matches while filtering", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/admin/connected-systems.tsx", "utf8");
    expect(src).toContain("No system is connected. Connect a system to start.");
    expect(src).toContain("open={query ? true : undefined}");
    expect(src).not.toContain("How about");
  });
});
