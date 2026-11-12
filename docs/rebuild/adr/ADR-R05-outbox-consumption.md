# ADR-R05: Outbox by bucket: hot partition, consumer cursors, late rows and clock skew

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** ADR-02 (`09-target-architecture.md:34`), `10-data-mapping-cassandra.md:96-97,115`, `11-opensearch-index.md:65-70`, `07-integrations.md:35-37`, `14-non-functional.md:48`

## Context
Commands write the entity rows plus an outbox row in one logged batch; "the indexer and event fan-out read the outbox by time bucket" (`09:34`). The table is `event_outbox_by_bucket ((bucket), id timeuuid, ...)` with `bucket = yyyyMMddHHmm` (`10:96-97`). Nothing records which consumer has read which rows, what happens to a row written into a bucket a consumer already passed, or when rows are removed.

## Problem at scale
- One partition per bucket for the whole cluster: every write of every tenant in that window lands on the same partition, so its replica set takes the whole outbox write load while the rest of the ring idles. At more than 1k events per bucket plus bulk passes (ADR-R04 emits 200 per-document rows per batch) and access-change fan-out (ADR-R01), a bucket holds tens of thousands of rows with payload text; the "under 100 MB" rule at `10:115` is met, but the hot spot is by design.
- Two consumers (indexer, fan-out; a third if counts are derived) need independent progress. The prototype has one `delivered_at` flag on the outbox row (`0007_migration.sql:41`) meaning "fanned out" (`tmf-events.ts:51-52`); the indexer has no oracle at all. No cursor table exists in `10`.
- The bucket is computed from the writing node's clock and the `timeuuid` from the same node. A node whose clock trails the consumer's writes a row into a bucket the consumer has already finished: that document is never indexed (stale until a full reindex) and its event is never delivered. Across a hundred application nodes and several DCs this is routine, not exceptional.
- Rows have no TTL in the DDL: the table grows without bound; a replay (ADR-R06) has nothing to say about how far back it may go.

## Options
**A. Buckets plus consumer cursors plus a trailing watermark.** `outbox_cursor ((consumer), bucket, last_id)`; each consumer reads buckets up to `now - skew_allowance`, and re-reads the last few buckets looking for ids greater than its cursor. Rows get a TTL equal to the replay horizon.
Trade-off: hot partition remains; the skew allowance adds to the lag SLO at `11:70`.

**B. Sharded buckets.** Partition key `(bucket, shard)` with `shard = hash(document_id) % N`; consumers iterate N partitions per bucket (parallel workers can own shards). Same cursors as A.
Trade-off: N x the reads per bucket; removes the hot spot; N fixed at creation (changeable with a new table).

**C. Kafka as the outbox transport.** Commands still write the outbox row (durability), a relay publishes to a topic keyed by `document_id`; consumers are consumer groups with offsets; ordering per document is free.
Trade-off: a second system to run; the relay itself needs a cursor (A or B) so it does not remove the problem, it moves it to one consumer.

## Recommendation (not a decision)
B with A's cursors and watermark, and a TTL on outbox rows. Bucket assignment should use the coordinator's clock (`toTimestamp(now())` in the statement) rather than the application node's, so a single skewed node cannot write into the past. Keep C as the later step `07:36` already anticipates.

## Consequences for the rebuild
- New tables `outbox_cursor` and sharded `event_outbox_by_bucket`; the indexer and fan-out are two named consumers with separate cursors and lag metrics (ADR-R14).
- The lag SLO at `11:70` is restated as consumer lag plus skew allowance.
- Replay is defined as "reset a consumer's cursor to bucket X" within the TTL horizon.

## What the prototype oracle currently does
- A trigger inserts outbox rows in the same transaction as the document change (`drizzle/migrations/0007_migration.sql:48-66`), so no row can be lost or arrive late; ids are a sequence, so `order by id` is a total order (`src/services/tmf-events.ts:24-30`).
- There is no indexer; Postgres indexes the table itself.
