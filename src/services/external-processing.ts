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
import { audit, forbidden, type Db, type WriteEnv } from "@/services/seam-runtime";
import { DatabaseError, must } from "@/services/shared/must";

export interface ProcessingSwitch {
  /** Files wait for the organisation's own antivirus instead of the built-in check. */
  scan: boolean;
  /** Files wait for the organisation's own reader instead of the built-in reading. */
  read: boolean;
}
export const SWITCH_OFF: ProcessingSwitch = { scan: false, read: false };

/** `tenants.external_processing` as stored: only an own `true` turns a step on. */
export function readSwitch(raw: unknown): ProcessingSwitch {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return SWITCH_OFF;
  const own = (k: string) => Object.hasOwn(raw, k) && (raw as Record<string, unknown>)[k] === true;
  return { scan: own("scan"), read: own("read") };
}

/** Postgres "undefined column": the switch's migration has not reached this database. */
const UNDEFINED_COLUMN = "42703";

/**
 * The organisation's switch. Where the column does not exist yet nobody can have turned it on, so it
 * is off; any other failure stops the step (a scan must never fall back to simulation by accident).
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
  if (!data) throw new DatabaseError("reading the organisation's processing switch");
  return readSwitch((data as { external_processing?: unknown }).external_processing);
}

export interface ProcessingKey {
  id: string;
  name: string;
}
/** The organisation's active keys with this processing scope (normally none or one, D3). */
export async function activeProcessingKeys(
  admin: Db,
  tenantId: string,
  scope: ProcessingScope,
  now: Date,
): Promise<ProcessingKey[]> {
  const { data, error } = await admin
    .from("integration_clients")
    .select("id, name, scopes, revoked_at, expires_at, created_at")
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
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
 * Turns the organisation's own antivirus or reader on or off (D1). Organisation administrators only;
 * every change is recorded. Documents already in a step keep the mode they started with.
 */
export async function setSwitchStep(
  env: WriteEnv,
  patch: Partial<ProcessingSwitch>,
): Promise<SeamResult<ProcessingSwitch>> {
  if (env.role !== "tenant_admin") return forbidden();
  const before = await loadSwitch(env.admin, env.tenantId);
  const after: ProcessingSwitch = {
    scan: patch.scan ?? before.scan,
    read: patch.read ?? before.read,
  };
  const changed = (["scan", "read"] as const).filter((k) => before[k] !== after[k]);
  if (!changed.length) return { ok: true, data: after };
  must(
    await env.admin
      .from("tenants")
      .update({ external_processing: { ...after } })
      .eq("id", env.tenantId),
    "saving the organisation's processing switch",
  );
  for (const k of changed)
    await audit(
      env,
      "configChange",
      null,
      `externalProcessing.${k}: ${before[k] ? "on" : "off"} to ${after[k] ? "on" : "off"}`,
    );
  return { ok: true, data: after };
}
