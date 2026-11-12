# 08 — Search at scale (millions of documents)

## Behaviour to preserve
- **Landing view:** Documents opens with short lists instead of the full table:
  - Recent
  - Waiting for you (in review, for reviewers)
  - Expiring soon
  - On legal hold (admins only)

  A query that looks like an identifier (BR-104) offers "Go to record".
- **Searching:**
  - Search runs on the server: full text over name, description and **related record names**, plus the filters in BR-100.
  - Filters are kept in the URL after normalising (BR-101).
- **Paging and counts:**
  - Keyset paging, 50 rows per page, sorted by updated (default), name or expiry, always with id as the tie-breaker (BR-102).
  - The count is capped: the server counts up to 10,001 and the screen shows "More than 10,000 documents" (BR-103).
  - Facets count per type, status, sensitivity and record type, within the same visibility rule.
- **Saved views:** personal views for everyone; team views can be created by admins only.
- **Bulk changes:**
  - Select up to 10,000 documents (the whole result or picked rows). Actions: placeHold, releaseHold, setSensitivity, transition.
  - The job resolves ids **as the person**, then a worker processes them in batches of 200 (every minute).
  - Each document is re-checked with the single-document rules, including four-eyes (BR-022), and audited.
  - The result summary uses BR-107, and skips use the BR-106 reasons.
- **Opening a result:** the document opens in a side panel and the list keeps its position. Rows are drawn only while in view.

## Current implementation
- `_doc_search_where(caller, filters)` (SECURITY DEFINER) builds one WHERE clause, with the visibility rule inlined. Its values are quoted literals.
- It is used by `search_documents` (keyset), `count_documents` (LIMIT 10,001), `facet_documents` and `search_document_ids` (bulk).
- Indexes: (tenant, updated_at desc, id desc), (tenant, name, id), (tenant, type, updated), (tenant, status, updated), and full-text GIN.

## Rebuild
OpenSearch serves every search, count, facet and bulk-id call (see `11-opensearch-index.md`):
- `search_after: [sortValue, id]` for keyset paging.
- `track_total_hits: 10001` for the capped count.
- `terms` aggregations for facets.
- The access filter is part of every query, never applied afterwards.

Cassandra serves the landing lists through query-first tables (see 10). The detail panel reads Cassandra and calls `canSee`.

## Targets (not yet measured in the current app)
| Query | Target p95 |
|---|---|
| Search page (50 rows) at 5M docs | < 300 ms |
| Facets | < 500 ms |
| Capped count | < 200 ms |
| Bulk 10,000 | finished < 5 min, progress visible |
