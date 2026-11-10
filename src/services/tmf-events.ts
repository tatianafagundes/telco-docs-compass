// Delivers pending document events to subscribed systems. Called by a scheduled route.
// Events carry ids and lifecycle state only, never content or detail values.
import type { Db } from "@/services/seam-runtime";
import { eventMatches, hmacHex, RETRY_LIMIT, toTmfEvent } from "@/services/tmf667-mapper";

export async function deliverPending(admin: Db, origin: string): Promise<{ delivered: number; failed: number }> {
  const { data: events } = await admin
    .from("event_outbox")
    .select("id, tenant_id, event_type, document_id, created_at, payload, attempts")
    .is("delivered_at", null)
    .lt("attempts", RETRY_LIMIT)
    .order("id")
    .limit(50);
  if (!events || events.length === 0) return { delivered: 0, failed: 0 };
  const tenants = [...new Set(events.map((e) => e.tenant_id))];
  const { data: subs } = await admin
    .from("event_subscriptions")
    .select("id, tenant_id, callback, query, secret, integration_clients!inner(revoked_at)")
    .in("tenant_id", tenants)
    .is("integration_clients.revoked_at", null);

  let delivered = 0;
  let failed = 0;
  for (const e of events) {
    const targets = (subs ?? []).filter((s) => s.tenant_id === e.tenant_id && eventMatches(s.query, e.event_type));
    const body = JSON.stringify(toTmfEvent(origin, e));
    let error: string | null = null;
    for (const s of targets) {
      try {
        const res = await fetch(s.callback, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Signature": `sha256=${await hmacHex(s.secret, body)}`, "X-Event-Id": String(e.id) },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch {
        error = "unreachable";
      }
    }
    if (error) {
      failed++;
      await admin.from("event_outbox").update({ attempts: e.attempts + 1, last_error: error }).eq("id", e.id);
    } else {
      delivered++;
      await admin.from("event_outbox").update({ delivered_at: new Date().toISOString(), attempts: e.attempts + 1, last_error: null }).eq("id", e.id);
    }
  }
  return { delivered, failed };
}
