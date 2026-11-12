# ADR-R01: Visibility denormalisation (`visible_user_ids`) does not survive broad record access

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** ADR-01, ADR-05 (`09-target-architecture.md:33,40`), `11-opensearch-index.md:28-37,39-49,69`, `04-security-and-tenancy.md:55`, BR-090 (`03-business-rules.md:103`), invariant 3 (`17-kiro-steering/invariants.md:8`)

## Context
The index stores, per document, the union of every user with `entity_access` on any related record plus every user with an active share (`11-opensearch-index.md:35`). The access filter is a `term` on `visible_user_ids` (`11:47`), and "changes to access also emit outbox rows, so the visibility fields update" (`11:69`). The demo tenant has a manager with access to "all Sweden records" (`12-keycloak.md:35`), which the model treats as one `entity_access` row per record.

## Problem at scale
- A tenant with 5M documents and 20M records. Staff with broad record access (managers, back-office, shared service) number in the hundreds or thousands. Each such user appears in `visible_user_ids` of every document they can reach: 2,000 users x 5M documents = 10^10 keyword values in one tenant. Index size is dominated by the access list, not by the document.
- Granting one user access to a record with 50 documents reindexes 50 documents (fine). Granting one user access to 1M records reindexes every document of those records, millions of reloads from Cassandra, each needing `entity_access_by_entity` for every related record to recompute the union. Revoking does the same. One HR event = one full-tenant reindex.
- The outbox (`10-data-mapping-cassandra.md:96`) receives one row per affected document for one access change: millions of rows in one bucket.
- `entity_access_by_user` for such a user holds millions of rows in one partition (see ADR-R09).
- Only `tenant_admin` is exempt (`match_all`, `11:46`). Every other role with broad access pays the full price.

## Options
**A. Keep per-user lists, add a "broad access" flag.** Users above a cap of records are indexed as `match_all` like admins; `canSee` re-check (`11:37`) drops documents outside their records.
Trade-off: paging and the capped count become wrong for those users (filtered after fetch, pages shrink, count overstates); contradicts `08-search-at-scale.md:36` "never applied afterwards".

**B. Index the record side only; resolve the caller's record set at query time.** Documents keep `entity_ids` (`11:17`). Access is a `terms` lookup from a per-user access document (`erad-user-access/<user_id>` holding `entity_ids`) or an in-query `terms` list when small. Shares stay per document (`visible_user_ids` only for shares, which are few).
Trade-off: a user with millions of records exceeds any terms lookup limit (`index.max_terms_count`); access changes no longer reindex documents, only the user's access document.

**C. Two-tier access: segments plus explicit grants.** Add a derived access segment to each record and document (for example `tenant/region/product-line`, or "all records of referred_type X"), index it as `visible_segments`, and give users segment membership (from Keycloak groups or an app table). `entity_access` stays for explicit per-record grants, bounded by a cap and resolved as in B. Broad access is expressed as segments, never as millions of rows.
Trade-off: changes the domain model (`02-domain-model.md:28`, EntityAccess only); the segment of a record must be known at ingest; the visibility rule gains one clause (`OR caller in segment of a related record`).

## Recommendation (not a decision)
C, with B as the mechanism for explicit grants. The visibility truth table (`04:62`) is extended with the segment clause and stays the single rule. `canSee` re-check remains. The owner must decide whether a segment concept may enter the domain model and who assigns segments to records.

## Consequences for the rebuild
- Index mapping gains `visible_segments` (keyword) and loses most of `visible_user_ids`; `visible_user_ids` keeps shares only.
- New tables: `user_segments_by_user`, `record_segment` (or a column on `entities_by_tenant`); `entity_access_by_user` is capped.
- Access changes stop fanning out to documents; only a record's segment change does (bounded by documents of that record).
- The search filter mirrors the extended rule; the parity test against `can_see_document` is extended, not replaced.

## What the prototype oracle currently does
- `_doc_search_where` evaluates access per row with two `EXISTS` subqueries (`drizzle/migrations/0011_search_matches_record_names.sql:18-21`), no denormalisation; it has no broad-access concept beyond `tenant_admin`.
- Access writes (`src/services/document-write.functions.ts:502-523`) emit no outbox rows; the trigger is on `documents` only (`drizzle/migrations/0007_migration.sql:48-66`). The rebuild requirement at `11:69` has no oracle.
