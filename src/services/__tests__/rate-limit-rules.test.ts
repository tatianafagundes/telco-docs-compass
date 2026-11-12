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

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
import { DEFAULT_LIMITS, LIMIT_BOUNDS, WINDOW_SECONDS } from "@/services/rate-limit-rules";

describe("BR-110/BR-112/BR-113/BR-114 limits, window, headers and message", () => {
  it("BR-110 defaults are 120 reads and 30 changes per minute, bounds 1–6000 and 1–1000", () => {
    expect(DEFAULT_LIMITS).toEqual({ read: 120, write: 30 });
    expect(LIMIT_BOUNDS).toEqual({ read: { min: 1, max: 6000 }, write: { min: 1, max: 1000 } });
    expect(WINDOW_SECONDS).toBe(60);
    expect(isValidLimit("read", 0)).toBe(false);
    expect(isValidLimit("write", 1)).toBe(true);
  });
  it("BR-112 reset is max(1, 60 − UTC second) and remaining never goes below zero", () => {
    expect(decideRate(1, 30, at(59)).resetSeconds).toBe(1);
    expect(decideRate(1, 30, at(1)).resetSeconds).toBe(59);
    expect(decideRate(35, 30, at(0))).toEqual({ allowed: false, limit: 30, remaining: 0, resetSeconds: 60 });
    expect(decideRate(1, 30, at(0))).toEqual({ allowed: true, limit: 30, remaining: 29, resetSeconds: 60 });
  });
  it("BR-113 every header on an allowed reply, plus Retry-After on a refusal", () => {
    expect(rateHeaders(decideRate(5, 10, at(10)))).toEqual({
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "5",
      "RateLimit-Reset": "50",
      "RateLimit-Policy": "10;w=60",
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "5",
    });
    expect(rateHeaders(decideRate(11, 10, at(10)))).toEqual({
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": "50",
      "RateLimit-Policy": "10;w=60",
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "0",
      "Retry-After": "50",
    });
  });
  it("BR-114 the 429 message names the limit and the wait, says other systems are not affected, and points to Admin > Connected systems", () => {
    expect(retryGuidance("write", decideRate(31, 30, at(40)))).toBe(
      "This system has used its allowance of 30 changes per minute. Wait 20 seconds (see Retry-After) and send the request again. Other connected systems are not affected. An administrator can raise this system's allowance in Admin > Connected systems.",
    );
    expect(retryGuidance("read", decideRate(121, 120, at(0)))).toBe(
      "This system has used its allowance of 120 reads per minute. Wait 60 seconds (see Retry-After) and send the request again. Other connected systems are not affected. An administrator can raise this system's allowance in Admin > Connected systems.",
    );
  });
});
