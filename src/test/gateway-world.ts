// Test world for the TMF gateway (src/services/tmf-gateway.ts).
//
// The gateway loads the privileged client with a dynamic import, so each test file mocks that
// module with one line and `buildWorld()` decides what it answers:
//
//   vi.mock("@/integrations/supabase/client.server", async () =>
//     (await import("@/test/gateway-world")).clientServerMock);
//
// Then `buildWorld()` gives a fake database with one connected system and a few documents, and
// `call()` builds a Request the way an integrator's HTTP client would.
import { FakeDb, type Row } from "@/test/fake-db";
import { sha256Hex } from "@/services/tmf667-mapper";

export const holder: { db: FakeDb } = { db: new FakeDb() };
/** What the mocked `client.server` module exports: the fake database of the current world. */
export const clientServerMock = {
  get supabaseAdmin() {
    return holder.db;
  },
};

export const BASE = "https://app.example/api/public/tmf-api/document/v4";
export const TENANT = "tenant-a";
export const OTHER_TENANT = "tenant-b";
export const CLIENT_ID = "client-1";
export const OTHER_CLIENT_ID = "client-2";
/** A system key has the shape erad_ + 20 to 120 letters, digits, - or _. */
export const KEY = "erad_" + "k".repeat(24);
export const DOC_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_DOC_ID = "22222222-2222-4222-8222-222222222222";
/** The allowances the connected system has in `buildWorld()`. */
export const READ_LIMIT = 120;
export const WRITE_LIMIT = 30;
/** The Idempotency-Key `call()` sends on writes unless told otherwise. */
export const IDEM_KEY = "idem-key-0001";
export const ALL_SCOPES = [
  "read",
  "register",
  "transition",
  "approve",
  "hold",
  "delete",
  "subscribe",
];

export function docRow(over: Row = {}): Row {
  return {
    id: DOC_ID,
    tenant_id: TENANT,
    name: "Master agreement",
    description: null,
    document_type: "contract",
    status: "draft",
    pipeline_state: "ready",
    sensitivity: "internal",
    legal_hold: false,
    effective_date: null,
    expiry_date: null,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    current_version_id: "ver-1",
    characteristic: {},
    external_identifier: [],
    retain_until: null,
    bundle_id: null,
    registered_by_client: null,
    deleted_at: null,
    purged_at: null,
    ...over,
  };
}

export interface WorldOptions {
  scopes?: string[];
  client?: Row;
  documents?: Row[];
  /** What `api_hit` answers: how many requests this system has made this minute. */
  hits?: number;
  specs?: unknown[];
}

/** Builds the fake database, installs it for the mocked client module, and returns it. */
export async function buildWorld(opts: WorldOptions = {}): Promise<FakeDb> {
  const db = new FakeDb({
    integration_clients: [
      {
        id: CLIENT_ID,
        name: "Order care",
        tenant_id: TENANT,
        scopes: opts.scopes ?? ALL_SCOPES,
        revoked_at: null,
        expires_at: null,
        read_limit_per_minute: READ_LIMIT,
        write_limit_per_minute: WRITE_LIMIT,
        key_hash: await sha256Hex(KEY),
        ...opts.client,
      },
    ],
    // The organisation switch (file hooks): off unless a test turns it on.
    tenants: [
      { id: TENANT, external_processing: {} },
      { id: OTHER_TENANT, external_processing: {} },
    ],
    integration_tokens: [],
    documents: opts.documents ?? [
      docRow(),
      docRow({ id: OTHER_DOC_ID, tenant_id: OTHER_TENANT, name: "Someone else's" }),
    ],
    document_versions: [],
    document_relations: [],
    document_events: [],
    idempotency_keys: [],
    extraction_fields: [],
  })
    .withAutoId("documents")
    .onRpc("api_hit", opts.hits ?? 1)
    .onRpc("effective_specifications", opts.specs ?? []);
  holder.db = db;
  return db;
}

export interface CallOptions {
  key?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string | null;
}

/** A request as an integrator's HTTP client would send it. Writes get an Idempotency-Key unless told not to. */
export function call(method: string, path: string, opts: CallOptions = {}): Request {
  const headers: Record<string, string> = { ...opts.headers };
  const key = opts.key === undefined ? KEY : opts.key;
  if (key) headers["authorization"] = `Bearer ${key}`;
  const hasBody = opts.body !== undefined;
  if (hasBody) headers["content-type"] ??= "application/json";
  const idem = opts.idempotencyKey === undefined ? IDEM_KEY : opts.idempotencyKey;
  if (idem && method !== "GET") headers["idempotency-key"] = idem;
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(opts.body) : null,
  });
}

export async function json(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
