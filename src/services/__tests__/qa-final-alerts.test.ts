// Final QA pass: the quarantine-rate alert (R6.5), called directly with a fake database so each
// boundary is one row. The end-to-end alert is covered in gateway/qa-file-results-scan.test.ts.
// `it.fails` = asserts the correct behaviour and fails today (defect named above it).
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkQuarantineRate, INFECTED_DETAIL_PREFIX } from "@/services/file-result-alerts";
import { QUARANTINE_ALERT_PER_HOUR as LIMIT } from "@/services/file-hook-timeouts";
import type { SystemCtx } from "@/services/gateway-core";
import { FakeDb, type Row } from "@/test/fake-db";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const HOUR = 3_600_000;
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

const infected = (n: number, over: Row = {}): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${Math.random()}-${i}`,
    tenant_id: "t1",
    action: "scanResult",
    detail: `${INFECTED_DETAIL_PREFIX}: Eicar (ClamAV, attempt 1) · via Old AV`,
    created_at: at(1000 + i),
    ...over,
  }));
const ctxOf = (db: FakeDb, clientId = "client-av") =>
  ({ admin: db.asDb(), tenantId: "t1", clientId }) as unknown as SystemCtx;

function spyLogs() {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((m: unknown) => void lines.push(String(m)));
  return { lines, alerts: () => lines.filter((l) => l.includes('"level":"alert"')) };
}
afterEach(() => vi.restoreAllMocks());

describe("what the hourly count includes", () => {
  it.each([
    ["exactly the limit", LIMIT, 0],
    ["one over the limit", LIMIT + 1, 1],
  ])("%s: %i infected results in the hour give %i alert", async (_n, count, expected) => {
    const logs = spyLogs();
    await checkQuarantineRate(ctxOf(new FakeDb({ document_events: infected(count) })), NOW);
    expect(logs.alerts()).toHaveLength(expected);
  });

  it("an event exactly one hour old still counts; one millisecond older does not", async () => {
    const edge = spyLogs();
    const db = new FakeDb({
      document_events: [...infected(LIMIT), ...infected(1, { created_at: at(HOUR) })],
    });
    await checkQuarantineRate(ctxOf(db), NOW);
    expect(edge.alerts()).toHaveLength(1);
    vi.restoreAllMocks();
    const old = spyLogs();
    const db2 = new FakeDb({
      document_events: [...infected(LIMIT), ...infected(1, { created_at: at(HOUR + 1) })],
    });
    await checkQuarantineRate(ctxOf(db2), NOW);
    expect(old.alerts()).toEqual([]);
  });

  it("other tenants, other actions, clean and error results are not counted", async () => {
    const logs = spyLogs();
    const db = new FakeDb({
      document_events: [
        ...infected(LIMIT),
        ...infected(30, { tenant_id: "t2" }),
        ...infected(30, { action: "upload" }),
        ...infected(30, { detail: "Scan clean (ClamAV, attempt 1) · via Old AV" }),
        ...infected(30, { detail: "Scan could not check (ClamAV, attempt 1)" }),
        // A threat name that merely contains the words is not an infected result.
        ...infected(30, { detail: "Rescan infected: x" }),
      ],
    });
    await checkQuarantineRate(ctxOf(db), NOW);
    expect(logs.alerts()).toEqual([]);
  });

  it("the alert line carries ids and counts only: no threat name, no document, no file", async () => {
    const logs = spyLogs();
    const db = new FakeDb({
      document_events: infected(LIMIT + 1, {
        detail: `${INFECTED_DETAIL_PREFIX}: SECRET-THREAT (SECRET-ENGINE, attempt 1) · via SECRET-CLIENT`,
        document_id: "SECRET-DOC",
      }),
    });
    await checkQuarantineRate(ctxOf(db, "client-av"), NOW);
    expect(JSON.parse(logs.alerts()[0]!)).toEqual({
      level: "alert",
      op: "fileHooks.quarantineRate",
      tenant: "t1",
      client: "client-av",
      quarantinesLastHour: LIMIT + 1,
      limit: LIMIT,
    });
    expect(logs.lines.join("\n")).not.toMatch(/SECRET/);
  });

  it("every infected result past the limit logs again (alerting deduplicates)", async () => {
    const logs = spyLogs();
    const db = new FakeDb({ document_events: infected(LIMIT + 1) });
    await checkQuarantineRate(ctxOf(db), NOW);
    await checkQuarantineRate(ctxOf(db), NOW);
    expect(logs.alerts()).toHaveLength(2);
  });
});

describe("a failing count never changes the answer (it never throws)", () => {
  it("a database error is logged with a fixed step and no message from the database", async () => {
    const logs = spyLogs();
    const db = new FakeDb({ document_events: [] }).fail(
      "document_events",
      "select",
      "password=hunter2 host=db.internal",
    );
    await expect(checkQuarantineRate(ctxOf(db), NOW)).resolves.toBeUndefined();
    expect(JSON.parse(logs.lines[0]!)).toEqual({
      op: "fileHooks.quarantineRate",
      step: "database error while counting quarantines in the last hour",
    });
    expect(logs.lines.join("\n")).not.toMatch(/hunter2|db\.internal/);
  });

  it("an exception with a secret in its message is logged as a fixed word", async () => {
    const logs = spyLogs();
    const ctx = {
      admin: {
        from: () => {
          throw new Error("token=SECRET-TOKEN");
        },
      },
      tenantId: "t1",
      clientId: "c",
    } as unknown as SystemCtx;
    await expect(checkQuarantineRate(ctx, NOW)).resolves.toBeUndefined();
    expect(JSON.parse(logs.lines[0]!)).toEqual({
      op: "fileHooks.quarantineRate",
      step: "countFailed",
    });
  });

  it("a count the database does not return counts as zero: no alert", async () => {
    const logs = spyLogs();
    const ctx = {
      admin: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                like: () => ({
                  gte: () => ({ limit: async () => ({ count: null, error: null }) }),
                }),
              }),
            }),
          }),
        }),
      },
      tenantId: "t1",
      clientId: "c",
    } as unknown as SystemCtx;
    await checkQuarantineRate(ctx, NOW);
    expect(logs.lines).toEqual([]);
  });
});

describe("whose quarantines the count is (R6.5: one key)", () => {
  // Defect QA-F1, Low, src/services/file-result-alerts.ts:21-27. The count is the organisation's, not
  // the key's. The comment assumes one antivirus key per organisation (BR-163), but a key revoked and
  // replaced inside the hour leaves both keys' results in the count: 11 from the old key and 10 from the
  // new one raise an alert that names the new key as having quarantined 21 documents.
  // The activity detail carries "via <system name>" so the split exists in the data.
  it.fails(
    "two keys that each stay under the limit do not raise an alert naming one of them",
    async () => {
      const logs = spyLogs();
      const db = new FakeDb({
        document_events: [
          ...infected(11, {
            detail: `${INFECTED_DETAIL_PREFIX}: Eicar (ClamAV, attempt 1) · via Old AV`,
          }),
          ...infected(10, {
            detail: `${INFECTED_DETAIL_PREFIX}: Eicar (ClamAV, attempt 1) · via New AV`,
          }),
        ],
      });
      await checkQuarantineRate(ctxOf(db, "client-new"), NOW);
      expect(logs.alerts()).toEqual([]);
    },
  );
});
