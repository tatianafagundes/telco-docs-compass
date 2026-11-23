import { describe, expect, it } from "vitest";
import { defaultNavMode, parseNavMode } from "@/hooks/use-nav-mode";
describe("navigation mode", () => {
  it("starts as an icon rail below 1280px and with labels above", () => {
    expect(defaultNavMode(1279)).toBe("rail");
    expect(defaultNavMode(1280)).toBe("full");
  });
  it("keeps only a known stored choice", () => {
    expect(parseNavMode("rail")).toBe("rail");
    expect(parseNavMode("full")).toBe("full");
    expect(parseNavMode("wide")).toBeNull();
    expect(parseNavMode(null)).toBeNull();
  });
});
