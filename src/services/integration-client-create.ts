// Connecting a system: the checks and the record behind createSystem (integration-clients.functions.ts).
// A key for the organisation's own antivirus or reader has that one scope (D4), the organisation has at
// most one such key that is not disconnected (D3), and every new key is recorded in the activity log
// (file-hooks spec R6.2).
import { seamError, type SeamResult } from "@/services/document-rules";
import { processingScope, scopesAllowed } from "@/services/processing-keys";
import { audit, forbidden, type WriteEnv } from "@/services/seam-runtime";

export interface NewSystem {
  name: string;
  systemKind: string;
  scopes: string[];
}
export interface IssuedKey {
  prefix: string;
  hash: string;
  expiresAt: string;
}
/** Postgres unique violation: the database index caught a second processing key (D3). */
const UNIQUE_VIOLATION = "23505";

export async function createSystemStep<Row extends { id: string }>(
  env: WriteEnv,
  input: NewSystem,
  key: IssuedKey,
  columns: string,
): Promise<SeamResult<Row>> {
  // Only the organisation's administrator connects systems; the group administrator does not.
  if (env.role !== "tenant_admin") return forbidden();
  const scopes = [...new Set(input.scopes)];
  if (!scopesAllowed(scopes))
    return { ok: false, error: seamError("system.scopesExclusive", "validation", "fixInput") };
  const processing = processingScope(scopes);
  if (processing) {
    // Disconnected keys do not count; an expired one still does until it is disconnected or renewed.
    const { data: existing, error } = await env.admin
      .from("integration_clients")
      .select("id, name, scopes")
      .eq("tenant_id", env.tenantId)
      .is("revoked_at", null);
    if (error) return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
    const other = (existing ?? []).find((c) => processingScope(c.scopes) === processing);
    if (other)
      return {
        ok: false,
        error: seamError("system.processingKeyExists", "conflict", "fixInput"),
      };
  }
  const { data: row, error } = await env.admin
    .from("integration_clients")
    .insert({
      tenant_id: env.tenantId,
      name: input.name,
      system_kind: input.systemKind,
      scopes,
      key_prefix: key.prefix,
      key_hash: key.hash,
      created_by: env.userId,
      expires_at: key.expiresAt,
    })
    .select(columns)
    .single();
  if (error?.code === UNIQUE_VIOLATION && processing)
    return { ok: false, error: seamError("system.processingKeyExists", "conflict", "fixInput") };
  if (error || !row)
    return { ok: false, error: seamError("seam.unavailable", "unavailable", "retry") };
  const created = row as unknown as Row;
  // Names and scopes only; never the key or its prefix.
  await audit(env, "systemConnected", null, `${input.name}: ${scopes.join(", ")}`);
  return { ok: true, data: created };
}
