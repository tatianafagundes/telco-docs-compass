// The same business rule must give the same answer whichever way a change arrives. Here the same
// document and the same request go through the TMF gateway (a connected system) and through a
// bulk change (a person selecting documents), and the outcomes are compared:
//
//   - which status moves are allowed,
//   - whether an approval waits for the details a person has to confirm,
//   - what a legal hold changes on the document.
//
// Only what both ways are meant to share is compared. Where the two ways deliberately work
// differently (who counts as "the same person", the fields each one records), nothing is asserted
// here. Changes made one screen at a time run inside server functions and are covered by their
// own tests.
import { describe, expect, it, vi } from "vitest";
import { buildWorld, call, DOC_ID, docRow, TENANT } from "@/test/gateway-world";
import { setLegalHold, transitionDocument } from "@/test/gateway-api";
import { processBulkJobs } from "@/services/bulk-worker";
import type { FakeDb } from "@/test/fake-db";
vi.mock(
  "@/integrations/supabase/client.server",
  async () => (await import("@/test/gateway-world")).clientServerMock,
);

const STATUSES = [
  "draft",
  "in_review",
  "approved",
  "effective",
  "superseded",
  "expired",
  "archived",
] as const;
const PERSON = "user-1";
const SPEC = [
  {
    code: "contract",
    definition: {
      specCharacteristic: [{ name: "counterparty", required: true, extractable: true }],
    },
  },
];
const field = (status: string) => ({
  document_id: DOC_ID,
  version_id: "ver-1",
  name: "counterparty",
  status,
});

type Outcome = {
  changed: boolean;
  status: unknown;
  legalHold: unknown;
  holdReason: unknown;
  holdReference: unknown;
};
const outcome = (db: FakeDb, changed: boolean): Outcome => {
  const row = db.rows("documents").find((d) => d["id"] === DOC_ID);
  return {
    changed,
    status: row?.["status"],
    legalHold: row?.["legal_hold"],
    holdReason: row?.["hold_reason"],
    holdReference: row?.["hold_reference"] ?? null,
  };
};

interface Scenario {
  doc?: Record<string, unknown>;
  fields?: ReturnType<typeof field>[];
}
async function seed({ doc = {}, fields = [] }: Scenario) {
  const db = await buildWorld({
    documents: [docRow({ document_type: "contract", ...doc })],
    specs: SPEC,
  });
  db.rows("extraction_fields").push(...fields);
  return db;
}

/** A connected system with every scope asks for the change. */
async function viaGateway(
  scenario: Scenario,
  op: { kind: "transition"; to: string } | { kind: "hold"; active: boolean; reason: string },
): Promise<Outcome> {
  const db = await seed(scenario);
  const res =
    op.kind === "transition"
      ? await transitionDocument(
          call("POST", `/document/${DOC_ID}/transition`, { body: { lifecycleState: op.to } }),
          DOC_ID,
        )
      : await setLegalHold(
          call("POST", `/document/${DOC_ID}/legalHold`, {
            body: { active: op.active, reason: op.reason },
          }),
          DOC_ID,
        );
  return outcome(db, res.status === 200);
}

/** A manager selects the document and starts a bulk change. */
async function viaBulk(
  scenario: Scenario,
  op: { kind: "transition"; to: string } | { kind: "hold"; active: boolean; reason: string },
): Promise<Outcome> {
  const db = await seed(scenario);
  for (const d of db.rows("documents")) d["created_by"] = "someone-else";
  db.tables["bulk_jobs"] = [
    {
      id: "job-1",
      tenant_id: TENANT,
      created_by: PERSON,
      actor_role: "manager",
      action: op.kind === "transition" ? "transition" : op.active ? "placeHold" : "releaseHold",
      params: op.kind === "transition" ? { to: op.to } : { reason: op.reason },
      doc_ids: [DOC_ID],
      total: 1,
      done: 0,
      changed: 0,
      skipped: {},
      status: "queued",
      created_at: "2026-11-10T10:00:00Z",
    },
  ];
  db.tables["user_roles"] = [{ user_id: PERSON, tenant_id: TENANT, role: "manager" }];
  db.tables["event_outbox"] = [];
  await processBulkJobs(db.asDb());
  const job = db.rows("bulk_jobs")[0];
  return outcome(db, job?.["changed"] === 1);
}

async function same(scenario: Scenario, op: Parameters<typeof viaGateway>[1]) {
  const g = await viaGateway(scenario, op);
  const b = await viaBulk(scenario, op);
  return { g, b };
}

describe("status moves are allowed or refused the same way", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES.filter((s) => s !== "draft" && s !== from)) {
      it(`${from} to ${to}`, async () => {
        const { g, b } = await same({ doc: { status: from } }, { kind: "transition", to });
        expect(b).toEqual(g);
      });
    }
  }
});

describe("an approval waits for the same details", () => {
  const inReview = { status: "in_review" };
  it.each([["pending"], ["rejected"], ["missing"]])(
    "is held back while the required detail is %s",
    async (state) => {
      const fields = state === "missing" ? [] : [field(state)];
      const { g, b } = await same(
        { doc: inReview, fields },
        { kind: "transition", to: "approved" },
      );
      expect(g.changed).toBe(false);
      expect(b).toEqual(g);
    },
  );
  it.each([["accepted"], ["edited"]])("goes through once the detail is %s", async (state) => {
    const { g, b } = await same(
      { doc: inReview, fields: [field(state)] },
      { kind: "transition", to: "approved" },
    );
    expect(g.changed).toBe(true);
    expect(b).toEqual(g);
  });
  it("ignores a detail confirmed on an older version", async () => {
    const old = { ...field("accepted"), version_id: "ver-0" };
    const { g, b } = await same(
      { doc: inReview, fields: [old] },
      { kind: "transition", to: "approved" },
    );
    expect(g.changed).toBe(false);
    expect(b).toEqual(g);
  });
  it("does not ask for details on other moves", async () => {
    const { g, b } = await same(
      { doc: { status: "draft" } },
      { kind: "transition", to: "in_review" },
    );
    expect(g.changed).toBe(true);
    expect(b).toEqual(g);
  });
});

describe("a legal hold changes the document the same way", () => {
  it("places a hold with its reason", async () => {
    const { g, b } = await same({}, { kind: "hold", active: true, reason: "Audit 2026" });
    expect(g).toEqual({
      changed: true,
      status: "draft",
      legalHold: true,
      holdReason: "Audit 2026",
      holdReference: null,
    });
    expect(b).toEqual(g);
  });
  it("releases a hold and clears the reason", async () => {
    const held = { legal_hold: true, hold_reason: "Audit 2026", hold_reference: "CASE-1" };
    const { g, b } = await same({ doc: held }, { kind: "hold", active: false, reason: "Closed" });
    expect(g).toMatchObject({ legalHold: false, holdReason: null, holdReference: null });
    expect(b).toMatchObject({ legalHold: false, holdReason: null, holdReference: null });
  });
  it("leaves the status alone", async () => {
    const { g, b } = await same(
      { doc: { status: "effective" } },
      { kind: "hold", active: true, reason: "Audit 2026" },
    );
    expect(g.status).toBe("effective");
    expect(b.status).toBe("effective");
  });
});
