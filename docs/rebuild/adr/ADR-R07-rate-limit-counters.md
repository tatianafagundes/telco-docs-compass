# ADR-R07: ADR-11 rate-limit counters cannot be built as written

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** ADR-11 (`09-target-architecture.md:46`), `10-data-mapping-cassandra.md:92-94`, BR-110 to BR-115 (`03-business-rules.md:127-132`), `07-integrations.md:13-15`, `12-keycloak.md:13`, invariant 11

## Context
ADR-11 says counters "use Cassandra counter tables with a TTL", keyed per (system, kind, window). `10:94` says in the same pack that "counters can't TTL". BR-112 defines the decision: allowed when hits including this request <= limit, reset = seconds left in the fixed window. The prototype gets the new count atomically from one statement (`api_hit`, `0012_tmf667_v4_conformance.sql:27-37`) using the database clock.

## Problem at scale
- Cassandra counter columns cannot carry a TTL. ADR-11 as written is not implementable; without TTL the table grows by (systems x kinds) rows per window, for ever, unless a purge job runs (`10:94` suggests one).
- A counter update returns nothing: the decision needs a second round trip to read the count, and the read is not the value the update produced when other nodes increment in between. Counter increments are not idempotent: a timed-out increment that is retried counts twice, so a system is refused below its allowance (false 429 against BR-112).
- Multi-DC at LOCAL_QUORUM: each DC sees its own increments first; a system whose calls land in two DCs gets up to twice the allowance until replication catches up, or is over-refused when counts merge.
- `window_start` is computed on the application node. With clock skew between nodes, one window is split across two rows and the count is under-stated; the prototype avoids this by using `now()` in the database.
- Limits live in two places in the target: Keycloak client attributes `read_limit`, `write_limit` (`12:13`) and `integration_clients_by_key.read_limit` (`10:88`), while Admin > Connected systems edits them in the application (`07:13-15`).

## Options
**A. Cassandra counters without TTL, plus purge job and separate read.** Closest to ADR-11.
Trade-off: inaccuracy above; two round trips per API call; purge job.

**B. Redis `INCR` + `EXPIRE` (or Bucket4j with a Redis backend).** One atomic call returns the count; expiry is native; the clock is Redis's own (`TIME`), so no skew between application nodes. One Redis per DC; systems are pinned to a DC by tenant (ADR-R14).
Trade-off: a new component in the stack list at `09:3-12`; Redis unavailable = decide fail-open or fail-closed.

**C. Limit at the API gateway.** Kong/APISIX/Spring Cloud Gateway rate limiting keyed by Keycloak client id, limits pushed from the application.
Trade-off: headers and the 429 message (BR-113, BR-114) must be produced by the gateway with the exact copy; limits become a gateway configuration synced from the app.

**D. Non-counter row with LWT.** `UPDATE api_rate SET hits=? WHERE ... IF hits=?` with retry.
Trade-off: a Paxos round per API call, up to 6000 per window per system; contention under load.

## Recommendation (not a decision)
B, keeping `rate-limit-rules.ts` as the pure decision (ported 1:1) and feeding it the count returned by `INCR`; `RateLimit-Reset` from Redis `TIME`. Owner decides fail-open vs fail-closed when Redis is unreachable, and confirms that limits are owned by the application table, with Keycloak carrying only identity and `tenant_id` (ADR-R12).

## Consequences for the rebuild
- ADR-11 is rewritten; Redis joins the stack and Testcontainers list.
- `api_rate` leaves `10`; `integration_clients` keeps the limits; Keycloak client attributes for limits are dropped from `12:13`.
- Metrics: 429 per system (already in `14:38`) plus Redis availability.

## What the prototype oracle currently does
- `api_hit` is one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING hits` on the database clock, and it also deletes stale rows on every call (`drizzle/migrations/0012_tmf667_v4_conformance.sql:31-36`), a write and a scan per API request.
- `authenticate` calls it before every request and also updates `last_used_at` on the client row per request (`src/services/tmf-gateway.ts:92-104`): a hot row per system at the top allowance.
