import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, outcomeAfter, parseRetryAfter, subscribedBefore, verifyEventSignature } from "@/services/event-delivery-rules";
import { hmacHex, signedPayload } from "@/services/tmf667-mapper";

const now = new Date(Date.UTC(2026, 10, 10, 13, 0, 0));

describe("event-delivery-rules", () => {
  it("should mark any 2xx reply as delivered", () => {
    expect(outcomeAfter(1, 200, null)).toEqual({ kind: "delivered" });
    expect(outcomeAfter(3, 204, null)).toEqual({ kind: "delivered" });
  });
  it("should retry after 30 s, 2 min, 10 min, 30 min and 2 h", () => {
    expect([1, 2, 3, 4, 5].map((n) => outcomeAfter(n, 503, null))).toEqual([30, 120, 600, 1800, 7200].map((w) => ({ kind: "retry", waitSeconds: w })));
  });
  it("should give up after six attempts", () => {
    expect(MAX_ATTEMPTS).toBe(6);
    expect(outcomeAfter(6, 500, null)).toEqual({ kind: "gaveUp" });
  });
  it("should retry when the subscriber was unreachable", () => {
    expect(outcomeAfter(1, null, null)).toEqual({ kind: "retry", waitSeconds: 30 });
  });
  it("should honour a longer Retry-After, capped at one hour", () => {
    expect(outcomeAfter(1, 429, 300)).toEqual({ kind: "retry", waitSeconds: 300 });
    expect(outcomeAfter(1, 429, 10)).toEqual({ kind: "retry", waitSeconds: 30 });
    expect(outcomeAfter(1, 503, 99999)).toEqual({ kind: "retry", waitSeconds: 3600 });
  });
  it("should read Retry-After as seconds or an HTTP date", () => {
    expect(parseRetryAfter("120", now)).toBe(120);
    expect(parseRetryAfter("Tue, 10 Nov 2026 13:01:00 GMT", now)).toBe(60);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
  it("should send only events that happened after subscribing", () => {
    expect(subscribedBefore("2026-11-10T13:00:00Z", "2026-11-10T13:00:01Z")).toBe(true);
    expect(subscribedBefore("2026-11-10T13:00:02Z", "2026-11-10T13:00:01Z")).toBe(false);
  });
  it("should accept a correct recent signature and refuse tampering, wrong secrets and replays", async () => {
    const ts = String(now.getTime() / 1000);
    const body = '{"eventId":"1"}';
    const sig = `sha256=${await hmacHex("s3cret", signedPayload(ts, body))}`;
    expect(await verifyEventSignature("s3cret", ts, body, sig, now)).toBe(true);
    expect(await verifyEventSignature("s3cret", ts, '{"eventId":"2"}', sig, now)).toBe(false);
    expect(await verifyEventSignature("other", ts, body, sig, now)).toBe(false);
    expect(await verifyEventSignature("s3cret", ts, body, sig, new Date(now.getTime() + 301_000))).toBe(false);
    expect(await verifyEventSignature("s3cret", "abc", body, sig, now)).toBe(false);
  });
});

// ---------- BR audit additions (review/multi-perspective-2026-11) ----------
import { BACKOFF_SECONDS, isDelivered, MAX_RETRY_AFTER_SECONDS } from "@/services/event-delivery-rules";
import { SIGNATURE_TOLERANCE_SECONDS } from "@/services/tmf667-mapper";

describe("BR-120/BR-121/BR-123/BR-124 delivery rules", () => {
  it("BR-120 delivered means HTTP 2xx only", () => {
    expect(isDelivered(200)).toBe(true);
    expect(isDelivered(299)).toBe(true);
    expect(isDelivered(199)).toBe(false);
    expect(isDelivered(300)).toBe(false);
    expect(isDelivered(404)).toBe(false);
  });
  it("BR-121 backoff table, Retry-After honoured exactly up to 3600 s, and no retry after the sixth attempt", () => {
    expect([...BACKOFF_SECONDS]).toEqual([30, 120, 600, 1800, 7200]);
    expect(MAX_RETRY_AFTER_SECONDS).toBe(3600);
    expect(outcomeAfter(1, 503, 3600)).toEqual({ kind: "retry", waitSeconds: 3600 });
    expect(outcomeAfter(1, 503, 3601)).toEqual({ kind: "retry", waitSeconds: 3600 });
    expect(outcomeAfter(5, 503, 3600)).toEqual({ kind: "retry", waitSeconds: 7200 });
    expect(outcomeAfter(6, 503, 10)).toEqual({ kind: "gaveUp" });
  });
  it("BR-123 an event created at the same instant as the subscription is delivered", () => {
    expect(subscribedBefore("2026-11-10T13:00:00Z", "2026-11-10T13:00:00Z")).toBe(true);
  });
  it("BR-124 tolerance is 300 s inclusive, payload is '<timestamp>.<body>', wrong-length signatures are refused", async () => {
    expect(SIGNATURE_TOLERANCE_SECONDS).toBe(300);
    const ts = String(now.getTime() / 1000);
    const body = '{"eventId":"1"}';
    expect(signedPayload(ts, body)).toBe(`${ts}.${body}`);
    const sig = `sha256=${await hmacHex("s3cret", signedPayload(ts, body))}`;
    expect(await verifyEventSignature("s3cret", ts, body, sig, new Date(now.getTime() + 300_000))).toBe(true);
    expect(await verifyEventSignature("s3cret", ts, body, sig, new Date(now.getTime() - 300_000))).toBe(true);
    expect(await verifyEventSignature("s3cret", ts, body, sig, new Date(now.getTime() - 301_000))).toBe(false);
    expect(await verifyEventSignature("s3cret", ts, body, "sha256=abc", now)).toBe(false);
  });
});
