// The activity record of a connected system (seg L1): who did it is never cut off, and the
// system's name never brings control or direction characters into the screens.
import { describe, expect, it } from "vitest";
import { downloadedForScan, recordScanDownload } from "@/services/file-result-receipts";
import { audit } from "@/services/gateway-idempotency";
import type { SystemCtx } from "@/services/gateway-core";
import { FakeDb } from "@/test/fake-db";

const ctxFor = (db: FakeDb, name: string) =>
  ({ admin: db, tenantId: "tenant-a", name }) as unknown as SystemCtx;

describe("the activity record of a connected system", () => {
  it("cuts a long detail, never the system's name", async () => {
    const db = new FakeDb();
    await audit(ctxFor(db, "Acme AV"), "scanResult", "doc-1", "x".repeat(400));
    const detail = String(db.rows("document_events")[0]!["detail"]);
    expect([...detail].length).toBeLessThanOrEqual(160);
    expect(detail.endsWith(" · via Acme AV")).toBe(true);
  });
  it("cleans the system's name of direction and control characters", async () => {
    const db = new FakeDb();
    await audit(ctxFor(db, "Evil\u202E\u0007Name"), "download", "doc-1", "Download link");
    const detail = String(db.rows("document_events")[0]!["detail"]);
    expect(detail).not.toContain("\u202E");
    expect(detail).not.toContain("\u0007");
    expect(detail).toContain("via Evil");
  });
  it("records the version when one is given, and none otherwise", async () => {
    const db = new FakeDb();
    await audit(ctxFor(db, "Acme"), "pipelineStateChange", "doc-1", "a to b", "ver-1");
    await audit(ctxFor(db, "Acme"), "download", "doc-1", "Download link");
    expect(db.rows("document_events").map((e) => e["version_id"])).toEqual(["ver-1", undefined]);
  });
  it("a scan download receipt cleans the system's name and is still found for its attempt", async () => {
    const db = new FakeDb();
    const ctx = ctxFor(db, "AV\u202E" + "n".repeat(300));
    await recordScanDownload(ctx, "doc-1", "ver-1", 7);
    const detail = String(db.rows("document_events")[0]!["detail"]);
    expect(detail).not.toContain("\u202E");
    expect([...detail].length).toBeLessThanOrEqual(160);
    expect(await downloadedForScan(ctx, "doc-1", "ver-1", 7)).toBe(true);
    expect(await downloadedForScan(ctx, "doc-1", "ver-1", 70)).toBe(false);
  });
});
