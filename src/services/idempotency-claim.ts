// Claim-first idempotency: the Idempotency-Key is reserved BEFORE the work runs, so two calls with
// the same key at the same time cannot both do it.
//
//   claimKey     reserve the key (or learn it was used: replay, other body, still running)
//   completeKey  store the answer under the key, so a repeat gets it back
//   releaseKey   forget the claim after a failure, so the same key can retry
//
// A claim left by a worker that died is taken over after `CLAIM_STALE_SECONDS`; a stored answer
// stops counting after `IDEMPOTENCY_TTL_HOURS` (document-rules.ts). The table's primary key
// (tenant, actor, key, operation) is what makes the reservation exclusive.
//
// Does not know about HTTP or SeamResult: the screens and the API each decide what to answer.
import type { Json } from "@/integrations/supabase/types";
import { idempotencyCutoff } from "@/services/document-rules";
import { DatabaseError, must } from "@/services/shared/must";
import type { Db } from "@/services/seam-runtime";

/** How long a claim may stay unanswered before another call may take it over. */
export const CLAIM_STALE_SECONDS = 300;
const PENDING = { pending: true } as const;

export interface KeyId {
  tenantId: string;
  /** The person or the connected system that owns the key. */
  actor: string;
  key: string;
  operation: string;
}
export type Claim =
  | { kind: "claimed" }
  | { kind: "replay"; response: unknown }
  | { kind: "conflict" }
  | { kind: "inProgress" };

const match = (admin: Db, id: KeyId) =>
  admin
    .from("idempotency_keys")
    .delete()
    .eq("tenant_id", id.tenantId)
    .eq("actor", id.actor)
    .eq("key", id.key)
    .eq("operation", id.operation);

const isPending = (response: unknown) =>
  typeof response === "object" &&
  response !== null &&
  (response as { pending?: unknown }).pending === true;

/** Throws `DatabaseError` when the database fails, so nothing runs without a reservation. */
export async function claimKey(
  admin: Db,
  id: KeyId,
  requestHash: string,
  now = Date.now(),
): Promise<Claim> {
  // Clear what no longer counts: an answer past its lifetime, a claim abandoned by a dead worker.
  must(await match(admin, id).lt("created_at", idempotencyCutoff(now)), "clearing an old key");
  const abandoned = new Date(now - CLAIM_STALE_SECONDS * 1000).toISOString();
  must(
    await match(admin, id)
      .filter("response", "cs", JSON.stringify(PENDING))
      .lt("created_at", abandoned),
    "clearing an abandoned claim",
  );
  const claim = await admin.from("idempotency_keys").insert({
    tenant_id: id.tenantId,
    actor: id.actor,
    key: id.key,
    operation: id.operation,
    request_hash: requestHash,
    response: PENDING as unknown as Json,
    created_at: new Date(now).toISOString(),
  });
  if (!claim.error) return { kind: "claimed" };
  // Somebody has the key. Find out who, and what it means for this call.
  const { data: row, error } = await admin
    .from("idempotency_keys")
    .select("request_hash, response")
    .eq("tenant_id", id.tenantId)
    .eq("actor", id.actor)
    .eq("key", id.key)
    .eq("operation", id.operation)
    .maybeSingle();
  if (error || !row) throw new DatabaseError("claiming an idempotency key");
  if (row.request_hash !== requestHash) return { kind: "conflict" };
  return isPending(row.response)
    ? { kind: "inProgress" }
    : { kind: "replay", response: row.response };
}

/** Stores the answer. Never throws: the work is already done, and a repeat just runs the claim rules again. */
export async function completeKey(admin: Db, id: KeyId, response: unknown): Promise<void> {
  try {
    must(
      await admin
        .from("idempotency_keys")
        .update({ response: response as Json })
        .eq("tenant_id", id.tenantId)
        .eq("actor", id.actor)
        .eq("key", id.key)
        .eq("operation", id.operation),
      "storing the answer of an idempotency key",
    );
  } catch (e) {
    console.error(JSON.stringify({ op: "idempotency.complete", step: (e as Error).message }));
  }
}

/** Forgets the claim after a failure so the same key can retry. Never throws; a leftover claim expires by itself. */
export async function releaseKey(admin: Db, id: KeyId): Promise<void> {
  try {
    must(
      await match(admin, id).filter("response", "cs", JSON.stringify(PENDING)),
      "releasing an idempotency key",
    );
  } catch (e) {
    console.error(JSON.stringify({ op: "idempotency.release", step: (e as Error).message }));
  }
}
