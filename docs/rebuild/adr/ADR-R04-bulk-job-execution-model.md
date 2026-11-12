# ADR-R04: Bulk job execution model (claim, resume, idempotency, progress, events)

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** `08-search-at-scale.md:19-23,46`, BR-105, BR-108, BR-142 (`03-business-rules.md:119,122,161`), `02-domain-model.md:40` (BulkJob), ADR-02, ADR-03 (`09-target-architecture.md:34-38`), invariant 10

## Context
A bulk job resolves up to 10,000 ids as the person, then "a worker processes them in batches of 200" per scheduler pass (`08:21`). The target row at `08:46` expects the whole job to finish well inside the window that 50 passes of 200 would need. `10-data-mapping-cassandra.md` has no table for bulk jobs. The prototype keeps the job in one row with `doc_ids uuid[]` and a `done` offset (`0009_document_search_at_scale.sql:152-173`).

## Problem at scale
- 10,000 ids in 200-id batches = 50 batches. One batch per pass cannot meet the target at `08:46`; the prototype already runs three rounds per call (`src/routes/api/public/jobs/bulk-documents.ts:13-15`), which the docs do not say.
- Two Spring instances both run the scheduler: no claim exists on the job, so both take the same `done` offset, both change the same 200 documents, both write 200 audit rows and both emit a `DocumentBatchEvent` (`bulk-worker.ts:95`): duplicate audit rows and duplicate events across passes, against invariant 10 and BR-125.
- Worker dies after changing 120 of 200 documents: `done`, `changed` and `skipped` are written only at the end of the batch (`bulk-worker.ts:96-100`). The retry re-reads from the old offset; the 120 are now "unchanged" skips, so the summary (BR-107) reports them as skipped although they changed and were audited. Any exception marks the whole job `failed` with no resume (`bulk-worker.ts:121-124`).
- The prototype processes the five oldest jobs in order (`bulk-worker.ts:116`): one tenant's 10,000-document job is head-of-line for every other tenant among hundreds.
- Per-document writes bypass the status LWT (`bulk-worker.ts:72-82` are plain updates); in the rebuild each of the 200 must go through the same command (LWT `IF status=:from`, audit, outbox) as a single action, otherwise ADR-03 is void for bulk.
- `DocumentBatchEvent` carries `document_id = documentIds[0]` and is matched against the facts of that first document only (`bulk-worker.ts:104-112`, `tmf-events.ts:44`): subscription filters on `status=` or `documentType=` apply to one arbitrary document of the batch.

## Options
**A. Job row with offset, claimed by LWT lease.** `bulk_jobs_by_id (id, tenant_id, ..., ids frozen<list<uuid>>, done, changed, skipped map<text,int>, status, locked_until, locked_by)`; `bulk_jobs_due ((status_bucket), created_at, id)`. A worker claims with `UPDATE ... SET locked_until=? IF locked_until < now`, runs batches until the lease nears its end, writes progress after every batch. Per-document outcome stored in `bulk_job_items ((job_id), doc_id, outcome)` so a retry skips items already recorded instead of re-checking them as "unchanged".
Trade-off: an LWT per claim; per-item rows (10,000 per job, one partition, small).

**B. Items as the queue.** `bulk_job_items` is the unit of work; workers claim slices `(job_id, slice)` with LWT; progress is a counter over slices. Parallel slices per job, no head-of-line blocking.
Trade-off: more LWTs; ordering of changes across slices irrelevant for these actions.

**C. External queue (Kafka).** One message per item or slice; consumer groups give claim and parallelism for free.
Trade-off: a second system; `07-integrations.md:36` only mentions Kafka as "later".

## Recommendation (not a decision)
A, with item outcomes recorded per document, a lease per job, a fairness rule (round-robin over tenants with due jobs) and the single-document command reused per item. The `DocumentBatchEvent` should list ids only and be matched on `eventType` alone (owner to confirm against BR-142).

## Consequences for the rebuild
- New Cassandra tables for jobs, items and due jobs; progress visible from `bulk_jobs_by_id` after every batch.
- The worker is a Spring `@Scheduled` loop with lease renewal and bounded batches per pass; multi-instance safe.
- Per-document outbox rows are emitted by the reused command, so subscribers get per-document events as well as the batch event (the prototype trigger does both).

## What the prototype oracle currently does
- `startBulkJob` resolves ids as the caller and runs the first batch inline (`src/services/search.functions.ts:206-227`).
- `runBatch` slices by `done`, updates documents without a status precondition, audits each, emits one batch event, and writes progress once per batch (`src/services/bulk-worker.ts:23-101`).
