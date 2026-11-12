# 07 — Connected systems and events

## Connected systems (Admin > Connected systems, tenant admin only)
- **Creating a system:**
  - Fields: name, system kind, and scopes from read, register, transition, approve, hold, delete and subscribe.
  - Each system belongs to exactly one tenant.
- **Keys:**
  - A key is `erad_<random>`, shown **once** when created.
  - Only its SHA-256 hash and prefix are stored. It expires after 365 days.
  - Rotating issues a new key with a new expiry, and the old one stops working at once; OAuth tokens already minted from the old key stay valid for up to 15 minutes in the reference (`tmf-gateway.ts:79-84`); whether rotation revokes them is the owner's decision.
  - Subscriptions end with the client: the reference keeps delivering signed events to subscriptions of an expired key (`tmf-events.ts:33-37` filters on `revoked_at` only).
  - Revoking takes effect immediately for the key and for its OAuth tokens.
- **OAuth:** `POST /oauth/token` with client credentials returns `eradt_…`, valid for 15 minutes and stored hashed.
- **Limits:**
  - Per-system read and change allowances per minute: defaults 120/30, bounds 1–6000 and 1–1000 (BR-110).
  - Counters are kept per (system, kind, minute window), so one system can't affect another.
- **Audit:** every API change is audited as a system action, with the system name.
- **Isolation:** every API query is pinned to the key's tenant. Sweden keys never see Norway.

## Event flow
```text
documents change ──trigger──▶ event_outbox(row, tenant, type, payload{lifecycleState, previous})
   scheduler every minute ──▶ POST /tmf-events/deliver
      1. fan out: each new outbox row → one event_deliveries row per same-tenant subscription
         whose query matches and that was created at or before the event (BR-123)
      2. claim due rows (next_attempt_at <= now, not locked) with SKIP LOCKED, set locked_until
      3. POST signed JSON to callback (X-Signature, X-Signature-Timestamp, X-Event-Id)
      4. 2xx → delivered_at; else attempts++, next_attempt_at = now + max(backoff, Retry-After≤3600);
         after 6 attempts → gave_up_at
```
- Subscription `query` filters on `eventType=…`, `status=…` and `documentType=…`. Old and new event names both match.
- Receivers dedupe on `X-Event-Id`. The id is stable across retries.
- Unsubscribing, or revoking the system, stops pending deliveries.

## Rebuild mapping
- **Outbox:** Cassandra has no triggers. Each command handler writes the document change and an `event_outbox_by_bucket` row in one **logged batch**, in the same partition-tenant scope (see 10).
- **Fan-out and delivery:** a Spring `@Scheduled` worker, or a Kafka consumer if Kafka is adopted later. Use an LWT on `event_delivery` (`UPDATE … IF locked_until < now`) to emulate SKIP LOCKED.
- **Search sync:** the same outbox feeds the OpenSearch indexer.
- **Retries:** use the same pure functions (`outcomeAfter`, `parseRetryAfter`), ported to Java with the same tests.
