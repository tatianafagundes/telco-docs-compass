# ADR-R09: Partition sizing: `entity_access_by_user` and `audit_by_tenant_day`

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** `10-data-mapping-cassandra.md:12,19,55-58,79-81,115`, Q3, Q10, BR-090, BR-093, BR-095 (`03-business-rules.md:103,107,109`), `04-security-and-tenancy.md:27`

## Context
`entity_access_by_user ((user_id), entity_id)` serves "records a user can access" (Q3) and `canSee`. `audit_by_tenant_day ((tenant_id, day), at)` serves the admin activity screen (Q10). `10:115` states the sizing rule: partitions under 100 MB.

## Problem at scale
- A manager with access to "all records" of a tenant (`12-keycloak.md:35`) with 20M records = 20M rows in one `entity_access_by_user` partition: several GB, unreadable in one query and a compaction and repair hazard. Every listEntities call and every "Shared with me" record check (BR-093) for that user reads that partition. The same user appears in 20M `entity_access_by_entity` partitions, so revoking their access is 20M deletes.
- `audit_by_tenant_day`: BR-095 lets clients write `view` and `download` events; 100 connected systems at up to the read allowance per window, plus people, plus a bulk job writing 10,000 rows at once, plus the expiry job (ADR-R11) = millions of rows per tenant per day-partition, each with `detail text`. That is above the rule at `10:115` which this table was introduced to satisfy.
- `audit_by_document` is fine (per document). `deletions_by_tenant`, `holds_by_tenant` (`10:20-21`) are single partitions per tenant with no bucket: holds are few, deletions over years are not.

## Options
**A. Bucket the partitions.** `entity_access_by_user ((user_id, bucket), entity_id)` with `bucket = hash(entity_id) % 64`; `audit_by_tenant_day ((tenant_id, day, bucket), at)` with a fixed fan; `deletions_by_tenant ((tenant_id, year_bucket), ...)`.
Trade-off: a point check "does user U have access to entity E" still hits one partition (bucket is derivable), but listing all records of a user reads 64 partitions; the admin activity screen merges N buckets per day for a timeline.

**B. Model broad access as segments, cap explicit grants (ADR-R01).** `entity_access_by_user` holds only explicit per-record grants, bounded by a cap enforced at grant time; users beyond the cap must be covered by a segment. Listing a broad user's records becomes a query by segment on `entities_by_tenant` (or the index).
Trade-off: domain model change (same as ADR-R01).

**C. Move the tenant activity timeline to OpenSearch.** Cassandra keeps the append-only record per document; an `erad-audit` index (references only, never detail values, invariant 9) serves the admin screen with filters and paging; the per-tenant-day table is dropped.
Trade-off: one more index and consumer; audit stays append-only in Cassandra; search over audit gains filters the screen does not have today.

## Recommendation (not a decision)
B for access (it is the same decision as ADR-R01) and C for the tenant timeline, with A's year bucket for `deletions_by_tenant`. The owner decides whether admin activity may be served from a derived index.

## Consequences for the rebuild
- `entity_access_by_user` gains a cap and is paired with segments; the visibility truth table covers the segment clause.
- `audit_by_tenant_day` is replaced by an audit index fed by the outbox consumer; `audit_by_document` stays the record of truth per document.
- The admin activity screen reads the index; `04:26` ("activity rows without a document") maps to index documents with no `document_id`.

## What the prototype oracle currently does
- `entity_access (entity_id, user_id)` with an index on `(user_id, entity_id)` (`drizzle/migrations/0009_document_search_at_scale.sql:15`); `document_events` is one table with an identity id (`0000_documents_schema_v0_1_0.sql:220-229`); the demo manager is granted all records explicitly.
