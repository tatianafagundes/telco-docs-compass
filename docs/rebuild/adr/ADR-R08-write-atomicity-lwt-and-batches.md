# ADR-R08: Status change = LWT + logged batch is not one atomic step; counters and tombstones

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** ADR-02, ADR-03, ADR-05 (`09-target-architecture.md:34-40,49-55`), `10-data-mapping-cassandra.md:5,48-53,107-108,112,116`, `07-integrations.md:35`, ADR-01

## Context
`10:112`: "`UPDATE documents_by_id SET status=:to ... IF status=:from`. On success, batch the denormalised rows, the audit row and the outbox row." ADR-02 says the command writes "the entity row(s) plus the outbox row in one logged batch". `07:35` adds "in the same partition-tenant scope". `documents_by_entity` is maintained by `DELETE old + INSERT new` on every update (`10:53`). `doc_counts_by_tenant` is a counter table (`10:107`).

## Problem at scale
- A conditional statement (LWT) applies to one partition and cannot be combined in a batch with writes to other partitions. So the status change is two steps: LWT on `documents_by_id`, then a logged batch over `documents_by_entity` (one partition per related record), `audit_by_document`, `audit_by_tenant_day`, `event_outbox_by_bucket`. The tables have different partition keys; "same partition-tenant scope" (`07:35`) does not hold. A crash between the two steps leaves `documents_by_id` changed, with no audit row, no outbox row, no index update and no event: the document is invisible to search in its new state until a full reindex, and invariant 9 (audit written by the operation) is broken for that change.
- The logged batch spans 5 to 8 partitions (a document on 3 records = 3 `documents_by_entity` partitions, each DELETE + INSERT). Logged batches across partitions are written to the batchlog first; `batch_size_fail_threshold` (default 50 KB) is reachable when the outbox payload and the `characteristic` JSON are duplicated into several rows.
- Counter mutations cannot be part of a logged batch with regular mutations. `doc_counts_by_tenant` in "one logged batch" (ADR-05, `09:40`) is not possible; a separate counter increment is non-idempotent on retry, so master counts (ADR-08) drift.
- `documents_by_entity` with `(updated_at, id)` clustering: each update leaves a tombstone in the record's partition until compaction after `gc_grace_seconds`. A customer record with 20k documents, each updated a few times, accumulates tens of thousands of tombstones; the record page (Q2, `10:11`) scans them on every read and hits `tombstone_warn_threshold`, then `tombstone_failure_threshold`.
- `10:116` says LWT uses "SERIAL / LOCAL_SERIAL" without choosing; the choice decides whether two DCs can both win (see ADR-R14).

## Options
**A. Outbox-first, LWT second, projections from the consumer.** (1) write the outbox row (idempotent id, "intent"), (2) LWT on `documents_by_id`, (3) the outbox consumer reloads the document (ADR-01) and writes every derived row (`documents_by_entity`, index, counts, events) idempotently keyed by `(id, updated_at)`. A crash after (1) is a no-op row; a crash after (2) is repaired by the consumer. No multi-partition logged batch. The audit row is its own write, keyed by the outbox id so it is idempotent (see the recommendation for who writes it).
Trade-off: the record page and audit lag by consumer lag (same SLO as search); audit written by the consumer, not the command (invariant 9 says "by the operation itself": the owner must accept "by the operation's consumer").

**B. Keep LWT + logged batch, add a repair scan.** A reconciliation job compares `documents_by_id.updated_at` with the index and the outbox, and re-emits missing rows.
Trade-off: the window of inconsistency is unbounded until the job runs; counters still outside the batch.

**C. Single-partition design.** Put document, audit, outbox and a per-document version list in one partition `((document_id), kind, at)` so one LWT batch covers them; derive every cross-document view (by entity, by tenant-day, by bucket) from the outbox consumer.
Trade-off: the outbox is then per document, so the consumer needs a discovery mechanism (CDC, or a secondary by-bucket pointer table written unconditionally first, as in A).

For `documents_by_entity`: cluster by `id` only (no DELETE on update; sort in memory, the record page shows a handful, BR-017) or serve the record page from OpenSearch with the `entityId` filter (BR-100) and drop the table.
For counts: derive from the index (`track_total_hits: true` per status per child tenant) or from a consumer-maintained non-counter row; drop the counter table.

## Recommendation (not a decision)
A, with audit written in step (2) as a second unconditional write in the command (accepting a rare orphan audit row when the LWT then fails, which is a visible "attempted" trace, not a loss), `documents_by_entity` clustered by id, counts from the index. The owner must decide whether invariant 9 permits derived audit rows written by a consumer, or whether the command keeps writing them.

## Consequences for the rebuild
- ADR-02 and `10:112` are rewritten as a three-step protocol; the request flow at `09:49-55` changes.
- The consumer becomes the single writer of every projection table; those tables become rebuildable like the index.
- `doc_counts_by_tenant` and the DELETE+INSERT rule at `10:53` are dropped.

## What the prototype oracle currently does
- One Postgres transaction: the update, the trigger-written outbox row and the audit insert are atomic (`drizzle/migrations/0007_migration.sql:48-66`, `src/services/seam-runtime.ts:128-137`); counts are a view over the table (`master_document_stats`).
