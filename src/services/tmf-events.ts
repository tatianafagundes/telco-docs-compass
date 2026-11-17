// Delivers document change notifications to subscribed systems. Called by a scheduled route.
// Events carry ids and lifecycle state only, never content or detail values.
//
// 1. Fan-out: each new outbox event gets one delivery record per matching subscription in the
//    same tenant (created before the event). Re-running fan-out is harmless (primary key).
// 2. Delivery: due records are claimed with a lock, so overlapping passes never send twice.
//    Success is recorded per subscriber; failures back off and retry for that subscriber only.
import type { Db } from "@/services/seam-runtime";
import {
  BACKOFF_SECONDS,
  DELIVERY_BATCH,
  DELIVERY_LOCK_SECONDS,
  DELIVERY_TIMEOUT_MS,
  outcomeAfter,
  parseRetryAfter,
  subscribedBefore,
} from "@/services/event-delivery-rules";
import { eventMatches, hmacHex, signedPayload, toTmfEvent } from "@/services/tmf667-mapper";
import { resolvesPublic } from "@/services/tmf-gateway";
import type { DocStatus } from "@/schemas/document";

const FAN_OUT_BATCH = 200;

export interface DeliveryPassResult {
  fannedOut: number;
  delivered: number;
  retrying: number;
  gaveUp: number;
  /** Deliveries given back untouched because we could not read what to send. */
  deferred: number;
}

async function fanOut(admin: Db): Promise<number> {
  const { data: events } = await admin
    .from("event_outbox")
    .select("id, tenant_id, event_type, document_id, created_at")
    .is("delivered_at", null)
    .order("id")
    .limit(FAN_OUT_BATCH);
  if (!events || events.length === 0) return 0;
  const tenants = [...new Set(events.map((e) => e.tenant_id))];
  const { data: subs, error: subsError } = await admin
    .from("event_subscriptions")
    .select("id, tenant_id, query, created_at, integration_clients!inner(revoked_at)")
    .in("tenant_id", tenants)
    .is("integration_clients.revoked_at", null);
  const docIds = [...new Set(events.map((e) => e.document_id))];
  const { data: docs, error: docsError } = await admin
    .from("documents")
    .select("id, status, document_type")
    .in("id", docIds);
  // Fail closed: without the subscribers or the document facts we cannot tell who should get the
  // event, and marking it handed over would lose it. Leave it pending; the next pass retries.
  if (subsError || docsError) return 0;
  const facts = new Map(
    (docs ?? []).map((d) => [
      d.id,
      { status: d.status as DocStatus, documentType: d.document_type },
    ]),
  );

  const rows = events.flatMap((e) =>
    (subs ?? [])
      .filter(
        (s) =>
          s.tenant_id === e.tenant_id &&
          subscribedBefore(s.created_at, e.created_at) &&
          eventMatches(s.query, e.event_type, facts.get(e.document_id)),
      )
      .map((s) => ({ event_id: e.id, subscription_id: s.id, tenant_id: e.tenant_id })),
  );
  if (rows.length > 0) {
    const { error } = await admin
      .from("event_deliveries")
      .upsert(rows, { onConflict: "event_id,subscription_id", ignoreDuplicates: true });
    if (error) return 0; // leave the events pending; the next pass fans them out again
  }
  // The outbox's delivered_at now means "handed to every subscriber's delivery queue".
  const { error: markError } = await admin
    .from("event_outbox")
    .update({ delivered_at: new Date().toISOString() })
    .in(
      "id",
      events.map((e) => e.id),
    );
  if (markError) return 0; // fanned out already; the next pass repeats it harmlessly (upsert ignores duplicates)
  return rows.length;
}

/**
 * Gives claimed deliveries back without counting an attempt, after a failure that was ours (we
 * could not read what to send). `next_attempt_at` moves out by the first backoff step so a
 * persistent failure retries every 30 s, not on every pass. Only rows still locked by this claim
 * are touched, so a pass that took over after our lock expired is not disturbed.
 */
async function deferClaims(
  admin: Db,
  claimed: {
    event_id: number;
    subscription_id: string;
    tenant_id: string;
    locked_until: string | null;
  }[],
) {
  const next = new Date(Date.now() + BACKOFF_SECONDS[0] * 1000).toISOString();
  for (const d of claimed) {
    let q = admin
      .from("event_deliveries")
      .update({ locked_until: null, next_attempt_at: next })
      .match({ event_id: d.event_id, subscription_id: d.subscription_id, tenant_id: d.tenant_id });
    if (d.locked_until) q = q.eq("locked_until", d.locked_until);
    await q;
  }
}

export async function deliverPending(admin: Db, origin: string): Promise<DeliveryPassResult> {
  const fannedOut = await fanOut(admin);
  const result: DeliveryPassResult = {
    fannedOut,
    delivered: 0,
    retrying: 0,
    gaveUp: 0,
    deferred: 0,
  };

  const { data: claimed, error: claimError } = await admin.rpc("claim_event_deliveries", {
    p_limit: DELIVERY_BATCH,
    p_lock_seconds: DELIVERY_LOCK_SECONDS,
  });
  if (claimError || !claimed || claimed.length === 0) return result;

  const { data: events, error: eventsError } = await admin
    .from("event_outbox")
    .select("id, tenant_id, event_type, document_id, created_at, payload")
    .in("id", [...new Set(claimed.map((c) => c.event_id))]);
  const { data: subs, error: subsError } = await admin
    .from("event_subscriptions")
    .select("id, tenant_id, callback, query, secret")
    .in("id", [...new Set(claimed.map((c) => c.subscription_id))]);
  if (eventsError || subsError) {
    // We could not even read what to send. That says nothing about the subscriber, so do NOT give
    // the deliveries up: release them (no attempt counted) and let the next pass try again.
    await deferClaims(admin, claimed);
    result.deferred = claimed.length;
    return result;
  }
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));
  const subById = new Map((subs ?? []).map((s) => [s.id, s]));
  const hostOk = new Map<string, boolean>();

  for (const d of claimed) {
    const e = eventById.get(d.event_id);
    const s = subById.get(d.subscription_id);
    const key = { event_id: d.event_id, subscription_id: d.subscription_id };
    // Defence in depth: never send across tenants even if a record were wrong.
    if (e && s && (e.tenant_id !== s.tenant_id || d.tenant_id !== s.tenant_id)) {
      await admin
        .from("event_deliveries")
        .update({
          gave_up_at: new Date().toISOString(),
          last_error: "subscription or event no longer matches",
          locked_until: null,
        })
        .match(key);
      result.gaveUp++;
      continue;
    }
    const attempt = d.attempts + 1;
    let status: number | null = null;
    let retryAfter: number | null = null;
    let error: string | null = null;
    if (!e || !s) {
      // Both reads worked yet one record is missing: odd, but not the subscriber's fault. Count it
      // as a failed attempt so it backs off and is eventually given up, instead of dropping it now.
      error = "event or subscription not found";
    } else {
      // Re-check DNS before each delivery: a public name could have been pointed at a private address.
      if (!hostOk.has(s.callback)) hostOk.set(s.callback, await resolvesPublic(s.callback));
      if (!hostOk.get(s.callback)) {
        error = "callback resolves to a private address";
      } else {
        const body = JSON.stringify(toTmfEvent(origin, e, s.query));
        const ts = String(Math.floor(Date.now() / 1000));
        try {
          const res = await fetch(s.callback, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Signature-Timestamp": ts,
              "X-Signature": `sha256=${await hmacHex(s.secret, signedPayload(ts, body))}`,
              // Stable across retries: receivers use it to ignore an event they already processed.
              "X-Event-Id": String(e.id),
              "X-Delivery-Attempt": String(attempt),
            },
            redirect: "error",
            body,
            signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
          });
          status = res.status;
          retryAfter = parseRetryAfter(res.headers.get("retry-after"), new Date());
          if (status < 200 || status >= 300) error = `HTTP ${status}`;
        } catch {
          error = "unreachable";
        }
      }
    }
    const outcome = outcomeAfter(attempt, status, retryAfter);
    const now = new Date();
    if (outcome.kind === "delivered") {
      await admin
        .from("event_deliveries")
        .update({
          attempts: attempt,
          delivered_at: now.toISOString(),
          last_status: status,
          last_error: null,
          locked_until: null,
        })
        .match(key);
      result.delivered++;
    } else if (outcome.kind === "retry") {
      const next = new Date(now.getTime() + outcome.waitSeconds * 1000).toISOString();
      await admin
        .from("event_deliveries")
        .update({
          attempts: attempt,
          next_attempt_at: next,
          last_status: status,
          last_error: error,
          locked_until: null,
        })
        .match(key);
      result.retrying++;
    } else {
      await admin
        .from("event_deliveries")
        .update({
          attempts: attempt,
          gave_up_at: now.toISOString(),
          last_status: status,
          last_error: error,
          locked_until: null,
        })
        .match(key);
      result.gaveUp++;
    }
  }
  return result;
}
