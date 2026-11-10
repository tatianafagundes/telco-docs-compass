// Delivers pending document events to subscribed systems. Called by a scheduled route.
// Events carry ids and lifecycle state only, never content or detail values.
import type { Db } from "@/services/seam-runtime";
import { eventMatches, hmacHex, RETRY_LIMIT, signedPayload, toTmfEvent } from "@/services/tmf667-mapper";
import { resolvesPublic } from "@/services/tmf-gateway";
import type { DocStatus } from "@/schemas/document";

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

  // Document facts used by subscription filters (status, documentType).
  const docIds = [...new Set(events.map((e) => e.document_id))];
  const { data: docs } = await admin.from("documents").select("id, status, document_type").in("id", docIds);
  const facts = new Map((docs ?? []).map((d) => [d.id, { status: d.status as DocStatus, documentType: d.document_type }]));
  const hostOk = new Map<string, boolean>();

  let delivered = 0;
  let failed = 0;
  for (const e of events) {
    const targets = (subs ?? []).filter((s) => s.tenant_id === e.tenant_id && eventMatches(s.query, e.event_type, facts.get(e.document_id)));
    let error: string | null = null;
    for (const s of targets) {
      // Re-check DNS before each delivery: a public name could have been pointed at a private address.
      if (!hostOk.has(s.callback)) hostOk.set(s.callback, await resolvesPublic(s.callback));
      if (!hostOk.get(s.callback)) {
        error = "callback resolves to a private address";
        continue;
      }
      const body = JSON.stringify(toTmfEvent(origin, e, s.query));
      const ts = String(Math.floor(Date.now() / 1000));
      try {
        const res = await fetch(s.callback, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Signature-Timestamp": ts,
            "X-Signature": `sha256=${await hmacHex(s.secret, signedPayload(ts, body))}`,
            "X-Event-Id": String(e.id),
          },
          redirect: "error",
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
