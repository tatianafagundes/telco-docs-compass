# ADR-R03: Index topology for hundreds of tenants (shared index, tenant routing, per-tenant index)

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** `11-opensearch-index.md:3,8`, `08-search-at-scale.md:31-37,40-46`, `14-non-functional.md:48`, ADR-01 (`09-target-architecture.md:33`)

## Context
`11:3` proposes one shared index `erad-documents-v1` with `_routing = tenant_id`, "or one index per tenant for very large tenants", with `number_of_shards: 6` (`11:8`). The scale target is 5M+ documents per tenant (`14:48`) for an operator with hundreds of tenants (countries and brands).

## Problem at scale
- Routing by `tenant_id` places all of a tenant's documents on one shard. A 5M-document tenant is one shard; every search, count, facet and bulk id query of that tenant hits that one shard, and all of that tenant's indexing load too. With 6 shards and hundreds of tenants, several large tenants share a shard, and their load adds up on the same shard while the others idle.
- 300 tenants x 2M documents = 600M documents in 6 shards = 100M documents per shard, far above common shard-size guidance; a shard cannot be split without `_split` (fixed multiples) or a reindex of the whole shared index, which is all-or-nothing across every tenant (`11:68`).
- Facet `terms` aggregations across several shards are approximate (`doc_count_error_upper_bound`); with tenant routing they are exact only because a tenant lives on one shard. Moving a large tenant to its own multi-shard index makes its facets approximate unless `shard_size` is raised.
- "One index per tenant for very large tenants" has no rule for when, who moves a tenant, how the application knows which index to query, or how a tenant is moved without downtime.

## Options
**A. One shared index with routing (as written).** Simple; facets exact per tenant.
Trade-off: hot shards, no per-tenant reindex, shard count fixed at creation.

**B. One index per tenant.** Per-tenant reindex, isolation, mapping version per tenant.
Trade-off: hundreds of indices x shards = thousands of shards; cluster state and per-node shard limits; small tenants waste a shard each.

**C. Size bands behind per-tenant aliases.** Small and medium tenants share banded indices with routing; each large tenant gets its own index with N shards and no routing. The application always queries alias `erad-documents-<tenant_id>` (filtered alias with `routing` where applicable). Moving a tenant = reindex by query into the target index, then swap the alias.
Trade-off: an alias per tenant (hundreds, fine); an operations runbook for band promotion; facet exactness depends on band (single-shard routed tenants exact, large tenants need `shard_size`).

## Recommendation (not a decision)
C. The alias per tenant is the stable contract the Java code depends on; the physical layout is an operations concern. The owner decides the bands (by document count) and whether large tenants may have approximate facets.

## Consequences for the rebuild
- `SearchRepository` resolves the alias from the caller's tenant; it never names a physical index.
- Reindex (ADR-R13) is per tenant via the alias, not per cluster.
- The `tenant_id` term filter stays in every query (defence in depth, `11:44`), even when the alias already filters.
- Metrics per index and per alias (ADR-R14).

## What the prototype oracle currently does
- Postgres has one table with partial indexes keyed by `tenant_id` (`drizzle/migrations/0009_document_search_at_scale.sql:8-12`); isolation is by WHERE clause, not by physical layout. There is no oracle for index topology.
