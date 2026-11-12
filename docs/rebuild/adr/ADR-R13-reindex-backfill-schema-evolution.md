# ADR-R13: Reindex, backfill and schema evolution at 5M documents per tenant

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** ADR-01 (`09-target-architecture.md:33`), `11-opensearch-index.md:3,10,23-24,65-69`, `10-data-mapping-cassandra.md:5,34-46`, `14-non-functional.md:42`, `15-test-strategy.md`

## Context
"A full reindex reads `documents_by_id` with a token-range scan into a new index, then swaps the alias" (`11:68`). The mapping is `dynamic: strict` (`11:10`) and carries derived fields: `record_names`, `entity_types`, `pending_required`, `needs_review`, `visible_user_ids`, `visible_tenant_ids` (`11:16-29`). "OpenSearch can be rebuilt from Cassandra at any time" (`14:42`).

## Problem at scale
- Building one index document needs, per document: the row, `business_entities` for each related record (names, types), `entity_access_by_entity` per record, `shares_by_document`, `grants_by_document`, `extraction_fields_by_document` plus the specification for `pending_required`. That is 5 to 8 point reads per document. At 5M documents per tenant and hundreds of tenants, a full rebuild is billions of point reads, not a token-range scan.
- A shared index (ADR-R03) makes the alias swap all-or-nothing: one tenant's mapping change or corruption forces every tenant to rebuild.
- `dynamic: strict` means every new field (a new filter in BR-100, a new facet) is a new index version and a full rebuild; the pack names no `schema_version` on the document and no dual-write period, so a rolling upgrade is unspecified.
- Derived-field backfills are bigger than mapping changes: a document specification that adds a required characteristic changes `pending_required` for every document of that type (millions), yet no outbox row is emitted for a specification change (`11:69` lists record access, shares and grants only).
- Cassandra evolution: adding columns is safe; any change proposed here or in ADR-R08/R09 (new partition keys) is a new table plus a token-range backfill with dual writes, and the pack names no migration tool, no checkpointing for a backfill that is interrupted, and no way to verify completeness.

## Options
**A. Pre-joined search source table.** `search_source_by_document ((document_id), ...)` maintained by the projection consumer with every derived field already resolved. Reindex reads one table with a token-range scan, one read per document; the consumer is the single place where the derivation lives.
Trade-off: one more projection table the size of the index; derived fields must be recomputed on every upstream change (which the consumer already must do to update the index).

**B. Reindex through the outbox.** Emit one outbox row per document (per tenant) and let the normal indexer rebuild into the new alias target.
Trade-off: the same 5 to 8 reads per document, serialised through the consumer; simplest code path.

**C. Spark or OpenSearch Hadoop job.** Bulk join in a batch engine.
Trade-off: a new runtime; good for the initial migration from the prototype data, heavy for routine reindex.

Orthogonal: a `schema_version` field in every index document and projection row; per-tenant aliases (ADR-R03) so a rebuild is per tenant; a `backfill_checkpoint ((job), token_range_start, done)` table for every scan job; a specification-change outbox row that fans out to the documents of that type (through `documents_by_type` or an index query).

## Recommendation (not a decision)
A plus every orthogonal item; B as the mechanism for small corrections (one document, one record). The owner decides whether a dedicated batch engine (C) is in scope for the initial data migration.

## Consequences for the rebuild
- New tables `search_source_by_document`, `backfill_checkpoint`; the indexer reads only the source table.
- `11:65-69` is rewritten: the consumer updates the source table first, then the index from it.
- A runbook per operation: reindex one tenant, add a field, change a partition key.

## What the prototype oracle currently does
- No index to rebuild; derived values are computed in the WHERE clause and in `search_documents` joins (`drizzle/migrations/0009_document_search_at_scale.sql:99-110`); schema changes are SQL migrations in `drizzle/migrations/`.
