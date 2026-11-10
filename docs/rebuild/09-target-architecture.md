# 09 — Target architecture

## Stack
- **Backend:**
  - Java 21 and Spring Boot 3.x (Web, Security OAuth2 Resource Server, Validation, Actuator).
  - DataStax Java driver 4.x for Cassandra 5.
  - opensearch-java client.
  - S3-compatible object storage.
- **Database:** Cassandra 5. Use Storage-Attached Indexes (SAI) only for low-cardinality admin lookups. OpenSearch handles everything search-related.
- **Identity:** Keycloak 2x (see 12).
- **Frontend:** Angular 18+ with standalone components and signals, and `keycloak-angular`.
- **Tests:** JUnit 5, AssertJ, Testcontainers (Cassandra, OpenSearch, Keycloak, MinIO), ArchUnit, RestAssured, Pact or OpenAPI validation, Playwright and axe-core, and k6 or Gatling.

## Modular monolith
```text
com.erad
 ├─ shared        (errors=SeamError, ids, clock, idempotency, audit writer)
 ├─ identity      (CallerContext from JWT + app_user_role check)
 ├─ tenant        (tenants, hierarchy, configuration, hard floors)        ← tenant-rules.ts, tenant-config.functions.ts
 ├─ access        (canSee, shares, cross-tenant grants, whyCanISee)       ← can_see_document, review-rules.ts (access part)
 ├─ document      (register, metadata, versions, status, delete/restore)  ← document-rules.ts, document-actions.ts, document-write.functions.ts
 ├─ review        (extraction fields, approve gate, four-eyes, checks)    ← review-rules.ts, review-flow-rules.ts
 ├─ pipeline      (upload, scan, read; simulated → real later)            ← upload-rules.ts, pipeline.functions.ts
 ├─ retention     (holds, retention, purge, deletion history)             ← retention.functions.ts
 ├─ search        (OpenSearch queries, saved views, bulk jobs)            ← search-rules.ts, search.functions.ts, bulk-worker.ts
 ├─ integration   (systems, keys/OAuth bridge, rate limits, TMF667 API)   ← tmf-gateway.ts, tmf667-mapper.ts, rate-limit-rules.ts
 └─ events        (outbox, fan-out, delivery, signing)                    ← tmf-events.ts, event-delivery-rules.ts
```
- **Rule classes:** each module keeps its rules in pure classes (no I/O) called `*Rules`. These are ported 1:1 from `reference/rules/*.ts`, with the tests ported 1:1 from `reference/rule-tests/`.
- **Controllers:** they only map HTTP. Application services enforce `canSee`, roles, and the audit write.

## Architecture decision records
1. **ADR-01 Cassandra is the source of truth; OpenSearch is a derived index.** The index can always be rebuilt, and search results are re-checked with `canSee`.
2. **ADR-02 Transactional outbox without SQL.** The command writes the entity row(s) plus the outbox row in one logged batch. The indexer and event fan-out read the outbox by time bucket.
3. **ADR-03 LWT for invariants.**
   - Status changes: `UPDATE … SET status=? IF status=?` (optimistic, so no lost updates).
   - Idempotency keys: `INSERT … IF NOT EXISTS`.
   - Delivery claims: `IF locked_until < now`.
4. **ADR-04 No row-level security; access is enforced in the service layer.** A single `DocumentAccessService` holds the access rule. An ArchUnit test forbids repositories in controllers. A truth-table test runs against the reference rule.
5. **ADR-05 Query-first denormalisation.** There is one table per access pattern (see 10), and writes fan out to them in a batch.
6. **ADR-06 Per-subscriber delivery rows.** These isolate failures and prevent duplicates (BR-125).
7. **ADR-07 One tenant and one role per user.** Keycloak claims carry them, and the app table confirms them.
8. **ADR-08 The group admin sees counts only.** The master module has no document DTOs.
9. **ADR-09 The error contract is SeamError internally and the TMF Error object externally.** Raw exceptions never reach clients.
10. **ADR-10 Append-only audit and versions.** Purge clears content and sets a tombstone; history rows remain.
11. **ADR-11 Rate-limit counters.** They use Cassandra counter tables with a TTL of 120 s, keyed per (system, kind, minute). An alternative is Redis.
12. **ADR-12 Download links.** Pre-signed object-store URLs (300 s / 60 s) are issued only after the access and content-lock checks.

## Request flow (write)
```text
Angular ─JWT─▶ Controller ─▶ AppService
   1 CallerContext (tenant, role)   2 load doc (Cassandra)   3 canSee + role + *Rules check
   4 BATCH: doc tables + audit + outbox (+ LWT where needed)  5 return DTO
Outbox ─▶ Indexer ─▶ OpenSearch        Outbox ─▶ Fan-out ─▶ Deliveries ─▶ Subscribers
```
