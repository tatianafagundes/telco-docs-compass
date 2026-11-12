# ADR-R06: Delivery queue: claim contention, give-up handling, replay, ordering, unsubscribe, secrets

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** ADR-03, ADR-06 (`09-target-architecture.md:35-38,41`), `10-data-mapping-cassandra.md:99-105`, `07-integrations.md:19-32,36`, BR-121, BR-123, BR-125 (`03-business-rules.md:138,140,142`), `14-non-functional.md:17,33,38`, invariant 10

## Context
Fan-out writes one `event_delivery` row per (event, subscription) and one `event_deliveries_by_due ((due_bucket), next_attempt_at, event_id, subscription_id)` row; a worker claims with an LWT `IF locked_until < now` to emulate `SKIP LOCKED` (`10:105`, `07:36`). After the sixth attempt the row gets `gave_up_at` (`07:28`) and nothing else is said. `07:32` says unsubscribing or revoking "stops pending deliveries". The subscription secret is shown once (`tmf-gateway.ts:636-638`); `14:33` says secrets live only in the vault.

## Problem at scale
- `due_bucket` granularity is unspecified. Whatever it is, every worker in the cluster scans the same head partition and tries the same first rows: with W workers, each LWT claim is contested by W-1 others, each failed claim is a wasted Paxos round, and the workers proceed in lock step through the partition. `SKIP LOCKED` lets each session skip to the next unlocked row inside the database; an LWT does not.
- At 1k events per bucket and S subscriptions per tenant that match, delivery rows per bucket = 1k x S. Nothing caps S per tenant or per system; a tenant with 50 subscriptions turns 1k events into 50k delivery rows and 50k outbound calls per bucket.
- Give-up is terminal with no visibility: no table keyed by subscription for the admin screen, no "resend" operation in the TMF hub API or the internal API, no dead-letter count in `14:38`. A subscriber that was down past the last backoff loses those events for good, and the operator cannot see which.
- Ordering: a retried `DocumentStateChangeEvent` can arrive after a later one for the same document; receivers dedupe on `X-Event-Id` (`07:31`) but cannot order. The payload carries `lifecycleState` and `previous`, so a receiver can detect but not repair.
- Unsubscribe in the prototype deletes the subscription and cascades to deliveries (`0014_event_deliveries.sql:3`); Cassandra has no cascade, so `07:32` needs an explicit rule. Revoking a system is checked at fan-out only (`tmf-events.ts:33-37`), not at send.
- Secret rotation does not exist: one secret per subscription, stored in clear (`0007_migration.sql:27`), shown once. A leaked secret can only be fixed by re-subscribing, which loses BR-123 continuity.

## Options
**A. One active delivery worker per DC with a lease, internal parallelism per subscription.** Leader claims a lease by LWT once; it reads the due partition without per-row LWTs, and dispatches rows to a bounded pool keyed by `subscription_id` (preserves per-subscription order, isolates slow subscribers).
Trade-off: a single consumer bounds throughput per DC; failover = lease expiry.

**B. Sharded due partitions.** `((due_bucket, shard), ...)` with `shard = hash(subscription_id) % N`; workers own shards; per-row LWT only on shard hand-over.
Trade-off: N fixed; per-subscription order holds within a shard.

**C. Kafka topic per tenant or partition by subscription.** Consumer groups give claim, order per key and replay by offset.
Trade-off: second system (`07:36`).

Orthogonal to the choice above: a `deliveries_by_subscription ((subscription_id, state), next_attempt_at, event_id)` table for the admin screen and a `resend` operation that resets `attempts` and `gave_up_at`; a cap on subscriptions per system; secrets encrypted with a vault key, with two valid secrets during rotation (`X-Signature` verified against either) and a `rotateSecret` operation; send-time check of `revoked_at` and subscription existence, which the prototype already does for tenant mismatch (`tmf-events.ts:80-83`).

## Recommendation (not a decision)
A for the first release (lease per DC, per-subscription ordered pool), B when one worker per DC is not enough, plus every item in the orthogonal list. The owner decides the subscription cap and whether `resend` is admin-only.

## Consequences for the rebuild
- New tables: `worker_lease`, `deliveries_by_subscription`; new operations `resend` and `rotateSecret` in `06-api`; a dead-letter metric per subscription.
- BR-125 is restated for the rebuild: "claimed by lease" instead of "SKIP LOCKED".
- Ordering guarantee documented as per-subscription in-order within a worker, at-least-once overall.

## What the prototype oracle currently does
- `claim_event_deliveries` uses `FOR UPDATE SKIP LOCKED` ordered by `event_id` (`drizzle/migrations/0014_event_deliveries.sql:22-36`), 50 rows per pass (`src/services/tmf-events.ts:15`); outcomes at `tmf-events.ts:118-130`; give-up only sets `gave_up_at`.
