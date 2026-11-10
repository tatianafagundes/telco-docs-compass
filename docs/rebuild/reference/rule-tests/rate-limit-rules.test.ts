import { describe, expect, it } from "vitest";
import { decideRate, isValidLimit, rateHeaders, rateKind, retryGuidance } from "@/services/rate-limit-rules";

const at = (s: number) => new Date(Date.UTC(2026, 10, 10, 13, 0, s));

describe("rate-limit-rules", () => {
  it("should allow the request that reaches the limit exactly", () => {
    expect(decideRate(120, 120, at(0))).toMatchObject({ allowed: true, remaining: 0 });
  });
  it("should refuse the first request over the limit", () => {
    expect(decideRate(121, 120, at(0)).allowed).toBe(false);
  });
  it("should tell the caller to wait until the minute ends", () => {
    expect(decideRate(31, 30, at(45)).resetSeconds).toBe(15);
    expect(decideRate(31, 30, at(0)).resetSeconds).toBe(60);
  });
  it("should send Retry-After only when refusing", () => {
    expect(rateHeaders(decideRate(5, 10, at(10)))["Retry-After"]).toBeUndefined();
    const h = rateHeaders(decideRate(11, 10, at(10)));
    expect(h["Retry-After"]).toBe("50");
    expect(h["RateLimit-Remaining"]).toBe("0");
    expect(h["RateLimit-Limit"]).toBe("10");
  });
  it("should count GET and HEAD as reads and everything else as changes", () => {
    expect(rateKind("GET")).toBe("read");
    expect(rateKind("head")).toBe("read");
    expect(rateKind("PATCH")).toBe("write");
    expect(rateKind("DELETE")).toBe("write");
  });
  it("should accept limits only within bounds", () => {
    expect(isValidLimit("read", 1)).toBe(true);
    expect(isValidLimit("read", 6000)).toBe(true);
    expect(isValidLimit("read", 6001)).toBe(false);
    expect(isValidLimit("write", 1000)).toBe(true);
    expect(isValidLimit("write", 1001)).toBe(false);
    expect(isValidLimit("write", 0)).toBe(false);
    expect(isValidLimit("read", 2.5)).toBe(false);
  });
  it("should name the wait time in the guidance", () => {
    expect(retryGuidance("write", decideRate(31, 30, at(40)))).toContain("Wait 20 seconds");
  });
});
