import { describe, expect, it } from "vitest";
import { createWindowLimiter } from "@/services/rate-limit-rules";

describe("createWindowLimiter under a flood of distinct keys", () => {
  it("keeps counting a key it already knows while thousands of new ones arrive", () => {
    const l = createWindowLimiter(2, 60_000);
    const now = 1_000_000;
    l.hit("victim", now);
    for (let i = 0; i < 5_000; i++) l.hit(`k${i}`, now);
    // The flood pushed the oldest keys out, but the limiter still works for new and recent ones.
    expect(l.hit("k4999", now)).toBe("record"); // its second hit of two allowed
    expect(l.hit("k4999", now)).toBe("summarise");
  });
  it("finishes a 50,000-key flood quickly", () => {
    const l = createWindowLimiter(1, 60_000);
    const started = Date.now();
    for (let i = 0; i < 50_000; i++) l.hit(`k${i}`, 1_000_000);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
