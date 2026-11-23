import { describe, expect, it } from "vitest";
import { navCurrent } from "@/lib/nav-section";

describe("navCurrent", () => {
  it("marks the page itself", () => {
    expect(navCurrent("/documents", "/documents")).toBe("page");
    expect(navCurrent("/shared", "/shared")).toBe("page");
  });
  it("keeps the section marked on pages inside it", () => {
    expect(navCurrent("/documents", "/records/ord-se-7731")).toBe("section");
    expect(navCurrent("/documents", "/records/ord-se-7731/review/abc")).toBe("section");
    expect(navCurrent("/shared", "/shared/11111111-1111-4111-8111-111111111111")).toBe("section");
    expect(navCurrent("/admin", "/admin/types")).toBe("section");
  });
  it("does not mark a section for a page that only starts with the same letters", () => {
    expect(navCurrent("/documents", "/documentsx")).toBeNull();
    expect(navCurrent("/shared", "/records/x")).toBeNull();
    expect(navCurrent("/holds", "/admin/holds")).toBeNull();
  });
});
import { homeFor } from "@/lib/nav-section";
describe("homeFor", () => {
  it("starts the group administrator in Admin and everyone else in Documents", () => {
    expect(homeFor("master_admin")).toBe("/admin");
    for (const r of ["tenant_admin", "manager", "reviewer", "contributor", "viewer", undefined])
      expect(homeFor(r)).toBe("/documents");
  });
});
import { adminAreaOf, adminAreas } from "@/lib/nav-section";
describe("adminAreas", () => {
  it("lists one Holds and retention entry per role, and each role's own areas", () => {
    const ta = adminAreas("tenant_admin").map((a) => a.label);
    const ma = adminAreas("master_admin").map((a) => a.label);
    expect(ta).toEqual(["Document types", "Policies", "Holds and retention", "Connected systems"]);
    expect(ma).toEqual(["Document types", "Policies", "Holds and retention", "Tenants"]);
    expect(adminAreas("manager")).toEqual([]);
  });
  it("names the area a page is in, including pages deeper in it", () => {
    expect(adminAreaOf("master_admin", "/admin/tenants/abc")?.label).toBe("Tenants");
    expect(adminAreaOf("tenant_admin", "/admin/systems")?.label).toBe("Connected systems");
    expect(adminAreaOf("tenant_admin", "/admin/tenants")).toBeNull();
  });
});
import { adminParent } from "@/lib/nav-section";
describe("adminParent", () => {
  it("links back to the area from a page inside it, and not on the area itself", () => {
    expect(adminParent("master_admin", "/admin/tenants/aurora-no")).toEqual({
      to: "/admin/tenants",
      label: "Tenants",
    });
    expect(adminParent("master_admin", "/admin/tenants")).toBeNull();
    expect(adminParent("tenant_admin", "/admin/typesX")).toBeNull();
  });
});
