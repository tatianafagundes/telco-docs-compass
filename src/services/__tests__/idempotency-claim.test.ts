import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/test/fake-db";
import {
  CLAIM_STALE_SECONDS,
  claimKey,
  completeKey,
  releaseKey,
  type KeyId,
} from "@/services/idempotency-claim";
import { DatabaseError } from "@/services/shared/must";

afterEach(() => vi.restoreAllMocks());
const ID: KeyId = {
  tenantId: "t1",
  actor: "a1",
  key: "key-00000001",
  operation: "document.delete",
};
const NOW = Date.parse("2026-11-17T10:00:00Z");
const db = () => new FakeDb({ idempotency_keys: [] });
const rows = (d: FakeDb) => d.rows("idempotency_keys");

describe("claimKey", () => {
  it("reserves a key nobody has used", async () => {
    const d = db();
    expect(await claimKey(d.asDb(), ID, "h1", NOW)).toEqual({ kind: "claimed" });
    expect(rows(d)).toHaveLength(1);
    expect(rows(d)[0]).toMatchObject({ response: { pending: true }, request_hash: "h1" });
  });
  it("lets only one of two simultaneous calls run", async () => {
    const d = db();
    const [a, b] = await Promise.all([
      claimKey(d.asDb(), ID, "h1", NOW),
      claimKey(d.asDb(), ID, "h1", NOW),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["claimed", "inProgress"]);
    expect(rows(d)).toHaveLength(1);
  });
  it("says 'in progress' while the first call has not answered", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    expect(await claimKey(d.asDb(), ID, "h1", NOW + 1000)).toEqual({ kind: "inProgress" });
  });
  it("replays the stored answer once the first call has finished", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    await completeKey(d.asDb(), ID, { ok: true, data: 7 });
    expect(await claimKey(d.asDb(), ID, "h1", NOW + 1000)).toEqual({
      kind: "replay",
      response: { ok: true, data: 7 },
    });
  });
  it("refuses the same key with another body, whether running or finished", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    expect(await claimKey(d.asDb(), ID, "other", NOW)).toEqual({ kind: "conflict" });
    await completeKey(d.asDb(), ID, { ok: true });
    expect(await claimKey(d.asDb(), ID, "other", NOW)).toEqual({ kind: "conflict" });
  });
  it("keeps keys of different actors, tenants and operations apart", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    for (const other of [{ actor: "a2" }, { tenantId: "t2" }, { operation: "document.hold" }])
      expect((await claimKey(d.asDb(), { ...ID, ...other }, "h1", NOW)).kind).toBe("claimed");
  });
  it("takes over a claim left by a worker that died", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    const later = NOW + (CLAIM_STALE_SECONDS + 1) * 1000;
    expect(await claimKey(d.asDb(), ID, "h1", later)).toEqual({ kind: "claimed" });
    expect(rows(d)).toHaveLength(1);
  });
  it("does not take over a claim that is still young", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    expect((await claimKey(d.asDb(), ID, "h1", NOW + (CLAIM_STALE_SECONDS - 5) * 1000)).kind).toBe(
      "inProgress",
    );
  });
  it("does not replay an answer older than 24 hours: the call runs again", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    await completeKey(d.asDb(), ID, { ok: true });
    const later = NOW + 25 * 3600_000;
    expect(await claimKey(d.asDb(), ID, "h1", later)).toEqual({ kind: "claimed" });
  });
  it("does not take over a finished answer just because the claim time passed", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    await completeKey(d.asDb(), ID, { ok: true });
    const later = NOW + (CLAIM_STALE_SECONDS + 60) * 1000;
    expect((await claimKey(d.asDb(), ID, "h1", later)).kind).toBe("replay");
  });
  it("throws, and runs nothing, when the database cannot be reached", async () => {
    const d = db().fail("idempotency_keys", "delete");
    await expect(claimKey(d.asDb(), ID, "h1", NOW)).rejects.toBeInstanceOf(DatabaseError);
  });
  it("throws when the reservation fails for a reason other than the key being taken", async () => {
    const d = db().fail("idempotency_keys", "insert");
    await expect(claimKey(d.asDb(), ID, "h1", NOW)).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe("releaseKey and completeKey", () => {
  it("release lets the same key run again", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    await releaseKey(d.asDb(), ID);
    expect(rows(d)).toEqual([]);
    expect((await claimKey(d.asDb(), ID, "h1", NOW)).kind).toBe("claimed");
  });
  it("release never removes a stored answer", async () => {
    const d = db();
    await claimKey(d.asDb(), ID, "h1", NOW);
    await completeKey(d.asDb(), ID, { ok: true });
    await releaseKey(d.asDb(), ID);
    expect(rows(d)).toHaveLength(1);
  });
  it("neither throws when the database refuses, and both log the step", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = db().fail("idempotency_keys", "update").fail("idempotency_keys", "delete");
    await expect(completeKey(d.asDb(), ID, {})).resolves.toBeUndefined();
    await expect(releaseKey(d.asDb(), ID)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
  });
});
