# ADR-R14: Multi-DC placement (SERIAL vs LOCAL_SERIAL, worker affinity) and the missing lag metrics

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** `10-data-mapping-cassandra.md:3,116`, ADR-03 (`09-target-architecture.md:35-38`), `14-non-functional.md:36-43,48`, `11-opensearch-index.md:70`, `07-integrations.md:36`

## Context
Keyspace `erad` uses NetworkTopologyStrategy with RF 3 (`10:3`), LOCAL_QUORUM, and "LWT uses SERIAL / LOCAL_SERIAL" (`10:116`), which names both without choosing. Scheduled workers (event fan-out and delivery, bulk, and after ADR-R11 expiry) are Spring `@Scheduled` (`07:36`). `14:36-39` names logs, three traces hops and five metrics. An operator with hundreds of tenants runs more than one DC.

## Problem at scale
- `LOCAL_SERIAL` is only correct when every conditional write to a given document comes from one DC. Two DCs both accepting status changes for the same document with LOCAL_SERIAL can both "win" `IF status=:from`, which is exactly the lost update ADR-03 exists to prevent. `SERIAL` is correct but makes every status change, idempotency reservation (ADR-R10), job claim (ADR-R04) and delivery claim (ADR-R06) a cross-DC Paxos round.
- Workers run in every DC by default: two fan-out workers, two delivery workers, two bulk workers on the same tables, contending on every claim and, where a claim is missing (bulk, ADR-R04), duplicating work.
- OpenSearch has no multi-DC statement: a cluster per DC each fed by its own indexer (consistent with ADR-01) or cross-cluster replication; the pack says neither. Object storage replication for versions is not named (`14:43` says only "versioned").
- Observability gaps against what this review relies on: no consumer lag per outbox consumer (ADR-R05), no index lag measurement for the SLO at `11:70` (`indexed_at` vs `updated_at` is not stored anywhere), no delivery backlog age or dead-letter count per subscription (ADR-R06), no bulk job age, no LWT failure rate, no tombstone or partition-size alerts per table (ADR-R08/R09), no per-tenant dimension on any metric although tenancy is the unit of blast radius.

## Options
**A. Tenant-to-DC affinity.** Each tenant has a home DC; the gateway routes a tenant's traffic (people by group, systems by `tenant_id`) to its home DC; workers run per DC and claim only jobs, deliveries and buckets of home tenants; LWT at LOCAL_SERIAL. The other DC is a replica for reads and failover, where failover re-homes tenants explicitly.
Trade-off: a routing layer with tenant awareness; a documented failover step; partitions keyed by tenant where workers select (outbox shard by tenant hash, due buckets by tenant).

**B. Active-active with SERIAL.** No affinity; every LWT is cross-DC.
Trade-off: LWT latency and failure rate under partition; workers still need a claim protocol that tolerates both DCs.

**C. Active-passive.** One DC writes; the other is standby.
Trade-off: simplest; wastes the second DC for writes; still needs A's failover step.

For observability, orthogonal to the choice: Micrometer gauges `outbox.lag{consumer}`, `index.lag{tenant}` (store `indexed_at` in the index document and compare with `updated_at`), `delivery.backlog{subscription}`, `delivery.deadletter{subscription}`, `bulk.job.age{tenant}`, `lwt.failures{table}`, Cassandra table metrics (tombstones, partition size) exported; every metric tagged by tenant (hundreds of values is acceptable cardinality) and by DC; alerts tied to the SLOs in `08:40-46` and `11:70`.

## Recommendation (not a decision)
A, with LOCAL_SERIAL and the metric list above added to `14:36-39`. The owner decides the home-DC rule for tenants and whether cross-DC failover is manual.

## Consequences for the rebuild
- `10:116` chooses LOCAL_SERIAL with the affinity precondition written next to it.
- Worker tables (outbox shards, due buckets, bulk due) gain a tenant or DC selector in the partition key.
- `11` adds `indexed_at`; `14` adds the metrics and per-tenant dimension; dashboards per tenant.

## What the prototype oracle currently does
- One Postgres instance, one scheduler (`src/routes/api/public/tmf-events/deliver.ts`, `src/routes/api/public/jobs/bulk-documents.ts`), `console.info` JSON logs with operation, tenant, document id and status (`src/services/seam-runtime.ts:36-38`); no metrics, no lag measurement.
