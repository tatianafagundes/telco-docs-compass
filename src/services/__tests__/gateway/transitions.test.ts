// Characterisation of the TMF status operation (POST .../transition): which moves are allowed,
// who may make them, and what stops an approval.
// The table of allowed moves is written out in full on purpose, so a change to the rule shows up here.
import { describe, expect, it, vi } from "vitest";
import {
  ALL_SCOPES,
  buildWorld,
  call,
  CLIENT_ID,
  DOC_ID,
  docRow,
  json,
  OTHER_CLIENT_ID,
} from "@/test/gateway-world";
import { transitionDocument } from "@/test/gateway-api";

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
const TARGETS = STATUSES.filter((s) => s !== "draft"); // the operation cannot ask for draft
const ALLOWED: Record<string, string[]> = {
  draft: ["in_review"],
  in_review: ["approved"],
  approved: ["effective"],
  effective: ["superseded", "expired"],
  superseded: ["archived"],
  expired: ["archived"],
  archived: [],
};

const move = (to: unknown, over: Parameters<typeof call>[2] = {}) =>
  transitionDocument(
    call("POST", `/document/${DOC_ID}/transition`, { body: { lifecycleState: to }, ...over }),
    DOC_ID,
  );

describe("every move of the status path", () => {
  for (const from of STATUSES) {
    for (const to of TARGETS) {
      const allowed = ALLOWED[from]!.includes(to);
      it(`${from} to ${to}: ${allowed ? "allowed" : "refused with 409"}`, async () => {
        const db = await buildWorld({ documents: [docRow({ status: from })] });
        const res = await move(to);
        if (allowed) {
          expect(res.status).toBe(200);
          expect(db.rows("documents")[0]?.["status"]).toBe(to);
          const events = db.writesTo("document_events", "insert").flatMap((w) => w.rows);
          expect(events[0]).toMatchObject({ action: "statusChange", document_id: DOC_ID });
        } else {
          expect(res.status).toBe(409);
          expect((await json(res))["code"]).toBe("transitionNotAllowed");
          expect(db.rows("documents")[0]?.["status"]).toBe(from);
          expect(db.writesTo("documents", "update")).toHaveLength(0);
        }
      });
    }
  }
});

describe("who may move a document", () => {
  it("approving needs the approve scope; every other move needs the transition scope", async () => {
    await buildWorld({
      scopes: ALL_SCOPES.filter((s) => s !== "approve"),
      documents: [docRow({ status: "in_review" })],
    });
    expect((await move("approved")).status).toBe(403);

    await buildWorld({
      scopes: ALL_SCOPES.filter((s) => s !== "transition"),
      documents: [docRow({ status: "draft" })],
    });
    expect((await move("in_review")).status).toBe(403);
  });

  it("the system that added a document cannot approve it (four-eyes)", async () => {
    const db = await buildWorld({
      documents: [docRow({ status: "in_review", registered_by_client: CLIENT_ID })],
    });
    const res = await move("approved");
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("fourEyesRequired");
    expect(db.rows("documents")[0]?.["status"]).toBe("in_review");
  });

  it("another system, or a document added in the app, can be approved", async () => {
    await buildWorld({
      documents: [docRow({ status: "in_review", registered_by_client: OTHER_CLIENT_ID })],
    });
    expect((await move("approved")).status).toBe(200);
    await buildWorld({ documents: [docRow({ status: "in_review", registered_by_client: null })] });
    expect((await move("approved")).status).toBe(200);
  });
});

describe("approval waits for the details a person has to confirm", () => {
  const spec = [
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

  it("refuses with 409 requiredDetailsPending while a required detail is not confirmed", async () => {
    const db = await buildWorld({ documents: [docRow({ status: "in_review" })], specs: spec });
    db.rows("extraction_fields").push(field("pending"));
    const res = await move("approved");
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("requiredDetailsPending");
    expect(db.rows("documents")[0]?.["status"]).toBe("in_review");
  });

  it("approves once the detail is accepted or edited", async () => {
    for (const confirmed of ["accepted", "edited"]) {
      const db = await buildWorld({ documents: [docRow({ status: "in_review" })], specs: spec });
      db.rows("extraction_fields").push(field(confirmed));
      expect((await move("approved")).status, confirmed).toBe(200);
    }
  });

  it("ignores the confirmation of an older version of the file", async () => {
    const db = await buildWorld({ documents: [docRow({ status: "in_review" })], specs: spec });
    db.rows("extraction_fields").push({ ...field("accepted"), version_id: "ver-0" });
    expect((await move("approved")).status).toBe(409);
  });
});

describe("a bad request is refused after the key is checked", () => {
  it.each([
    ["a status that does not exist", { lifecycleState: "published" }],
    ["draft, which cannot be asked for", { lifecycleState: "draft" }],
    ["no status", {}],
    ["a status that is not text", { lifecycleState: 7 }],
  ])("answers 400 invalidBody for %s", async (_name, body) => {
    await buildWorld();
    const res = await transitionDocument(
      call("POST", `/document/${DOC_ID}/transition`, { body }),
      DOC_ID,
    );
    expect(res.status).toBe(400);
    expect((await json(res))["code"]).toBe("invalidBody");
  });

  it("answers 404 for a document that is not ours, and does not change anything", async () => {
    const db = await buildWorld();
    const other = "22222222-2222-4222-8222-222222222222";
    const res = await transitionDocument(
      call("POST", `/document/${other}/transition`, { body: { lifecycleState: "in_review" } }),
      other,
    );
    expect(res.status).toBe(404);
    expect(db.writesTo("documents")).toHaveLength(0);
  });
});
