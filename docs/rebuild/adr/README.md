# Review ADRs (scale and architecture pass, 2026-11-12)

These are **proposals** that review ADR-01 to ADR-12 in `../09-target-architecture.md` and the data mapping in `../10`, `../11`, `../07`, `../14`. They do not change any invariant in `../17-kiro-steering/invariants.md`; where a proposal touches one (audit written by the operation, legal hold and expiry, one visibility rule), it says so and leaves the call to the owner. Status of every file is "Proposed (owner's decision)". Each ADR names what the prototype oracle does today so the parity tests can be kept.

| ADR | One line |
|---|---|
| [ADR-R01](ADR-R01-visibility-denormalisation.md) | `visible_user_ids` explodes with broad record access; access changes fan out to millions of documents. Proposes segment-based visibility plus capped explicit grants. |
| [ADR-R02](ADR-R02-share-and-grant-expiry-reindex.md) | No query finds shares or grants at expiry (`share_expiry` is not searchable); count, facets and bulk ids can include expired shares. Proposes nested `{id, expires_at}` filtered at query time. |
| [ADR-R03](ADR-R03-index-topology-per-tenant.md) | One shared six-shard index with tenant routing cannot hold hundreds of tenants at 5M documents. Proposes size bands behind a per-tenant alias. |
| [ADR-R04](ADR-R04-bulk-job-execution-model.md) | Bulk jobs have no claim, no resume and no per-item record; duplicates across instances. Proposes job lease, item outcomes and reuse of the single-document command. |
| [ADR-R05](ADR-R05-outbox-consumption.md) | Outbox bucket is a global hot partition with no consumer cursor, no late-row handling and no TTL. Proposes sharded buckets, cursors and a trailing watermark. |
| [ADR-R06](ADR-R06-delivery-queue.md) | LWT claims contend across workers; give-up has no dead letter, replay, ordering or secret rotation. Proposes a leased worker per DC, per-subscription pools, `resend` and `rotateSecret`. |
| [ADR-R07](ADR-R07-rate-limit-counters.md) | ADR-11 (counter tables with TTL) cannot be built; counters over-count on retry and split across DCs. Proposes Redis `INCR`+`EXPIRE` behind the same pure rules. |
| [ADR-R08](ADR-R08-write-atomicity-lwt-and-batches.md) | LWT cannot share a batch with other partitions; counters cannot be in logged batches; `documents_by_entity` DELETE+INSERT leaves tombstones. Proposes outbox-first, LWT second, projections from the consumer. |
| [ADR-R09](ADR-R09-partition-sizing-access-and-audit.md) | `entity_access_by_user` for a broad user and `audit_by_tenant_day` break the 100 MB rule. Proposes segments for access and an audit index for the tenant timeline. |
| [ADR-R10](ADR-R10-idempotency-keys.md) | Cassandra key drops actor and operation (cross-system replay inside a tenant); read-run-insert lets duplicates execute. Proposes reserve-run-complete with the four-part key. |
| [ADR-R11](ADR-R11-expiry-and-retention-scheduler.md) | The oracle expires on read with a tenant-wide UPDATE; Cassandra has no path. Proposes due tables by expiry and retain_until with a leased job, and asks the owner to settle hold-vs-expiry. |
| [ADR-R12](ADR-R12-identity-role-check-and-limits-source.md) | Per-request role read and "refuse on disagreement" lock users out after a role change; limits live in Keycloak and in the app. Proposes table-wins with cache and application-owned limits. |
| [ADR-R13](ADR-R13-reindex-backfill-schema-evolution.md) | Full reindex needs billions of point reads; `dynamic: strict` with a shared alias makes every field a global rebuild. Proposes a pre-joined search source table, `schema_version` and checkpointed backfills. |
| [ADR-R14](ADR-R14-multi-dc-and-observability.md) | `SERIAL / LOCAL_SERIAL` is unchosen; workers duplicate across DCs; lag metrics for every SLO are missing. Proposes tenant-to-DC affinity with LOCAL_SERIAL and a named metric set. |

Reading order: R08 and R05 (write path), then R01, R02, R03, R13 (search), then R04, R06, R11 (workers), then R07, R10, R12, R09, R14.
