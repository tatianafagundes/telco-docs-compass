import { describe, expect, it } from "vitest";
import { loginErrorText, safePath } from "@/lib/safe-path";
const O = "https://app.example";
describe("safePath", () => {
  it.each(["/.//evil.example", "/a/..//evil.example", "//evil.example", "/\\evil.example"])(
    "should never return an address that leaves the site for %s",
    (p) => expect(safePath(p, O)).toBe("/documents"),
  );
  it.each(["javascript:alert(1)", "https://evil.example/x", "", undefined])(
    "should fall back for %s",
    (p) => expect(safePath(p, O)).toBe("/documents"),
  );
  it("should keep a path and query on this site", () => {
    expect(safePath("/records/ord-1?doc=x", O)).toBe("/records/ord-1?doc=x");
    expect(safePath(`${O}/admin/types`, O)).toBe("/admin/types");
  });
});
describe("loginErrorText", () => {
  it("should not say whether the account exists, and say when to wait or reconnect", () => {
    expect(loginErrorText(400)).toContain("did not match");
    expect(loginErrorText(429)).toContain("Too many attempts");
    expect(loginErrorText(503)).toContain("couldn't reach");
    expect(loginErrorText(undefined)).toContain("couldn't reach");
  });
});
describe("log in page", () => {
  it("offers help for people who cannot log in (EDS sign in pattern)", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/routes/auth.tsx", "utf8")).toContain("Having trouble logging in?");
  });
});
