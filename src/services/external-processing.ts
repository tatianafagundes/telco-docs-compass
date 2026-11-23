// File hooks: the organisation switch (D1) and the organisation's own antivirus and reader (D3).
// Decides, when a document enters a step, who handles it. Spec: .kiro/specs/file-hooks (D1, D3, R4.1).
import type { Step } from "@/services/file-hook-detail";
import type { StepOwner } from "@/services/file-hook-rules";
import {
  isActiveKey,
  processingScope,
  scopesAllowed,
  STEP_SCOPE,
  type ProcessingScope,
} from "@/services/processing-keys";
import type { SeamResult } from "@/services/document-rules";
import { forbidden, type Db, type WriteEnv } from "@/services/seam-runtime";
import { DatabaseError, must } from "@/services/shared/must";

export interface ProcessingSwitch {
  /** Files wait for the organisation's own antivirus instead of the built-in check. */
  scan: boolean;
  /** Files wait for the organisation's own reader instead of the built-in reading. */
  read: boolean;
}
export const SWITCH_OFF: ProcessingSwitch = { scan: false, read: false };

/**
 * `tenants.external_processing` as stored: an object whose `scan` and `read`, when present, are
 * true or false. Anything else is not a switch (null): it is refused, never read as "off".
 */
export function parseSwitch(raw: unknown): ProcessingSwitch | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: ProcessingSwitch = { scan: false, read: false };
  for (const k of ["scan", "read"] as const) {
    if (!Object.hasOwn(raw, k)) continue;
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v !== "boolean") return null;
    out[k] = v;
  }
  return out;
}

/** Postgres "undefined column": the switch's migration has not reached this database. */
const UNDEFINED_COLUMN = "42703";

/**
 * The organisation's switch. Where the column does not exist yet nobody can have turned it on, so it
 * is off; any other failure, and a value that is not a switch, stops the step (a scan must never fall
 * back to simulation by accident).
 */
export async function loadSwitch(admin: Db, tenantId: string): Promise<ProcessingSwitch> {
  const { data, error } = await admin
    .from("tenants")
    .select("external_processing")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) {
    if (error.code === UNDEFINED_COLUMN) return SWITCH_OFF;
    throw new DatabaseError("reading the organisation's processing switch");
  }
  const sw = data
    ? parseSwitch((data as { external_processing?: unknown }).external_processing)
    : null;
  if (!sw) throw new DatabaseError("reading the organisation's processing switch");
  return sw;
}

export interface ProcessingKey {
  id: string;
  name: string;
}
/** More than one active key means nobody is chosen, so a few rows are enough to tell. */
const MAX_PROCESSING_KEYS_READ = 5;
/** The organisation's active keys with this processing scope (normally none or one, D3). */
export async function activeProcessingKeys(
  admin: Db,
  tenantId: string,
  scope: ProcessingScope,
  now: Date,
): Promise<ProcessingKey[]> {
  // Only keys that list this scope, so the read stays small whatever the organisation has connected.
  const { data, error } = await admin
    .from("integration_clients")
    .select("id, name, scopes, revoked_at, expires_at, created_at")
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .contains("scopes", [scope])
    .order("created_at", { ascending: true })
    .limit(MAX_PROCESSING_KEYS_READ);
  if (error) throw new DatabaseError("reading the organisation's connected systems");
  return (
    (data ?? [])
      // A key that also has other scopes (made before D4 was enforced) is never one of them.
      .filter(
        (c) =>
          processingScope(c.scopes) === scope && scopesAllowed(c.scopes) && isActiveKey(c, now),
      )
      .map((c) => ({ id: c.id, name: c.name }))
  );
}

/**
 * Whether a key may act as the organisation's own antivirus or reader: that one scope only (D4) and
 * the organisation's only active key for it (D3). Null for a key that is no processing key. Throws
 * when the keys cannot be read, so the caller refuses rather than lets it through.
 */
export async function designatedProcessingKey(
  admin: Db,
  client: { id: string; tenant_id: string; scopes: string[] },
  now: Date,
): Promise<boolean | null> {
  const scope = processingScope(client.scopes);
  if (!scope) return null;
  if (!scopesAllowed(client.scopes)) return false;
  const keys = await activeProcessingKeys(admin, client.tenant_id, scope, now);
  return keys.length === 1 && keys[0]!.id === client.id;
}

/**
 * Who handles each step if it starts now. Switch off: the built-in simulated step. Switch on: the
 * organisation's active key for that step; with none (revoked, expired, never connected) the step
 * still waits, names no system, and fails after the timeout. Turning a scanner off never turns
 * simulation back on (D1). With more than one active key (only possible before the database index
 * exists) nobody is chosen, so nobody can answer.
 */
export async function resolveOwners(
  admin: Db,
  tenantId: string,
  now: Date,
): Promise<Record<Step, StepOwner>> {
  const sw = await loadSwitch(admin, tenantId);
  const owner = async (step: Step): Promise<StepOwner> => {
    if (!(step === "scan" ? sw.scan : sw.read)) return { mode: "simulated" };
    const keys = await activeProcessingKeys(admin, tenantId, STEP_SCOPE[step], now);
    const only = keys.length === 1 ? keys[0]! : null;
    return only
      ? { mode: "external", by: only.name, byClient: only.id }
      : { mode: "external", by: null, byClient: null };
  };
  return { scan: await owner("scan"), read: await owner("read") };
}

/**
 * Turns the organisation's own antivirus or reader on or off (D1). Organisation administrators only.
 * One database call (`set_external_processing`) locks the row, changes only the named steps and
 * records each change in the same transaction, so two changes at once never undo each other and a
 * change is never left unrecorded. Documents already in a step keep the mode they started with.
 */
export async function setSwitchStep(
  env: WriteEnv,
  patch: Partial<ProcessingSwitch>,
): Promise<SeamResult<ProcessingSwitch>> {
  if (env.role !== "tenant_admin") return forbidden();
  const named = Object.fromEntries(
    (["scan", "read"] as const).filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]]),
  );
  const after = must(
    await env.admin.rpc("set_external_processing", {
      p_tenant: env.tenantId,
      p_actor: env.userId,
      p_patch: named,
    }),
    "saving the organisation's processing switch",
  );
  const sw = parseSwitch(after);
  if (!sw) throw new DatabaseError("saving the organisation's processing switch");
  return { ok: true, data: sw };
}
