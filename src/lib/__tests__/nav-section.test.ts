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
