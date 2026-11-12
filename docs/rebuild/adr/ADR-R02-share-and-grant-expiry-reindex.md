# ADR-R02: No path to find shares and grants at expiry; BR-094 against index lag

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** `11-opensearch-index.md:30,35-37,70`, `10-data-mapping-cassandra.md:71-74` (shares), Q7/Q8 (`10:16-17`), BR-090, BR-094 (`03-business-rules.md:103,108`), `04-security-and-tenancy.md:65`, invariant 4

## Context
`11:37` says expiring shares and grants "are re-indexed by a job at expiry time". The index stores `share_expiry` as `enabled: false` (`11:30`), so it is not searchable. The Cassandra tables `shares_by_document`, `shares_by_user`, `grants_by_document`, `grants_by_tenant` (`10:71-74`) are keyed by document, user or tenant, never by expiry. BR-094 and `04:65` require share removal to take effect at once, "including on cached search results", while the index has a lag SLO (`11:70`).

## Problem at scale
- A tenant with 5M documents and, say, 200k active shares with an expiry. The job at `11:37` has no query to ask "which shares expire in this bucket": neither the index (`enabled: false`) nor Cassandra offers one. The only options as written are a full scan of `shares_by_document` (one partition per document, 5M partitions) or of the index.
- A share that expires while the index is not yet updated still matches `visible_user_ids`. The `canSee` re-check hides the row, but the capped count, facets and `search_document_ids` (bulk) are computed inside the index and do not re-check: a bulk job started by a shared-only user can resolve ids of documents whose share expired since the last reindex (`08-search-at-scale.md:21`, `11:58`).
- Removing a share (BR-094) is an outbox row plus a reindex; between the write and the index update, the same gap exists for count, facets and bulk id resolution.

## Options
**A. Query-first due table.** `shares_by_expiry ((tenant_id, expiry_bucket), expires_at, document_id, user_id)` and `grants_by_expiry (...)`, written in the same projection as the share tables. A scheduled job scans the current bucket per tenant, emits one outbox row per document, and the indexer recomputes visibility.
Trade-off: one more table per share kind; a job per tenant; expiry still shows a lag equal to the job period plus index lag.

**B. Store expiry inside the index and filter at query time.** Replace `visible_user_ids` (keyword) with a `nested` field `{user_id, expires_at}` and filter `expires_at > now OR missing`. No job needed; expiry is exact at query time.
Trade-off: nested fields weigh more per document and per query; shares are few per document, so the weight is bounded; the facet and count become exact for expired shares.

**C. Keep as written and rely on the re-check.** Accept that count, facets and bulk id resolution may include expired shares until the next reindex.
Trade-off: contradicts `08:36` and leaves bulk id resolution able to touch documents the caller no longer sees.

## Recommendation (not a decision)
B for shares and grants (both are small per document). The bulk job must re-check `canSee` per document in the worker (it already does per BR-108), so bulk stays safe. For removal (BR-094) the write path should also evict the document from the index synchronously (a direct `update` call after the Cassandra write, outbox row as backup), so the immediacy test at `04:65` can pass without waiting for the consumer.

## Consequences for the rebuild
- Mapping change for `visible_user_ids`/`visible_tenant_ids` to nested `{id, expires_at}`; `share_expiry` is dropped.
- `search_document_ids` must be followed by a per-document `canSee` in the bulk worker before any change (already BR-108).
- The share revoke command gets a synchronous index update step with a defined failure mode (log, outbox repairs).

## What the prototype oracle currently does
- Expiry is evaluated at query time inside the WHERE clause (`drizzle/migrations/0011_search_matches_record_names.sql:20`), so counts, facets and bulk ids are exact; there is no job and nothing to reindex.
- Bulk id resolution runs as the caller (`src/services/search.functions.ts:206-213`); the worker then re-checks per document (`src/services/bulk-worker.ts:58-68`) but by role only, not by visibility.
