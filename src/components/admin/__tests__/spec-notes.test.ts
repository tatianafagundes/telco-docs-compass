import { describe, expect, it } from "vitest";
import { sectionNotes } from "@/components/admin/spec-notes";
const LOCKED = "Locked by Aurora Telecom Group.";
describe("sectionNotes", () => {
  it("should show a shared tag and reason once for the section, not under every field", () => {
    const n = sectionNotes(
      Array.from({ length: 5 }, () => ({ source: "locked" as const, reason: LOCKED })),
    );
    expect(n.source).toBe("locked");
    expect(n.reason).toBe(LOCKED);
    expect(n.perField.every((f) => f.source === null && f.reason === null)).toBe(true);
  });
  it("should keep the tag per field where fields differ, and still lift a shared reason", () => {
    const n = sectionNotes([
      { source: "changed", reason: null },
      { source: "inherited", reason: null },
    ]);
    expect(n.source).toBeNull();
    expect(n.reason).toBeNull();
    expect(n.perField.map((f) => f.source)).toEqual(["changed", "inherited"]);
  });
  it("should keep reasons per field when only some fields are blocked", () => {
    const n = sectionNotes([
      { source: "inherited", reason: "Floor set by the group." },
      { source: "inherited", reason: null },
    ]);
    expect(n.source).toBe("inherited");
    expect(n.perField.map((f) => f.reason)).toEqual(["Floor set by the group.", null]);
  });
});
