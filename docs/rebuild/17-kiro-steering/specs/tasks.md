# Tasks

Each task ends when its listed tests pass. Phases are done in order.

## P1 Foundation and identity
- [ ] 1.1 docker-compose with Cassandra 5, OpenSearch, Keycloak (realm import with the 5 demo users) and MinIO
- [ ] 1.2 Spring Boot skeleton with modules and ArchUnit rules
- [ ] 1.3 CallerContext from the JWT plus an `app_user_role` check (R1.1)
- [ ] 1.4 Port `DocumentRules`, `DocumentActions` and their tests (BR-001–017)
- [ ] 1.5 Angular shell, tokens, ERAD components, Keycloak login, role-filtered navigation

## P2 Documents core
- [ ] 2.1 CQL schema for documents, versions, relations, access and audit (10)
- [ ] 2.2 `DocumentAccessService.canSee` plus the truth-table tests (BR-090)
- [ ] 2.3 register, addVersion and pipeline simulation; UploadRules plus tests (BR-060–069)
- [ ] 2.4 transition with LWT, setHold, delete and restore (BR-010–016, 050–056)
- [ ] 2.5 Shares and cross-tenant grants; Shared with me (BR-091–094)
- [ ] 2.6 Records page and document panel in Angular; the parity run of `share-isolation`

## P3 Details and approval
- [ ] 3.1 ReviewRules and ReviewFlowRules plus tests (BR-020–043)
- [ ] 3.2 reviewExtraction (copies into characteristic, audits the name only)
- [ ] 3.3 Check-details page with footer, tabs and shortcuts; UI journey test with four-eyes

## P4 Holds, retention and configuration
- [ ] 4.1 TenantRules plus tests; effective specifications (BR-080–087)
- [ ] 4.2 Retention, holds, deletion history and purge with tombstone; admin screens

## P5 Search
- [ ] 5.1 OpenSearch index, outbox indexer and reindex job (11)
- [ ] 5.2 SearchRules plus tests; search, count, facets, saved views; Documents page
- [ ] 5.3 Bulk jobs with worker and per-document re-check (BR-105–108); load test at 5M

## P6 TMF667 API
- [ ] 6.1 TMF mapper plus tests (BR-130–139); routes and alias; error JSON for unknown paths
- [ ] 6.2 Keycloak client-credentials auth, scopes and tenant pinning; idempotency
- [ ] 6.3 RateLimitRules plus counters; parity runs of `tmf-api` and `tmf-rate-isolation`

## P7 Events and connected systems
- [ ] 7.1 Outbox fan-out, delivery claims with LWT, EventDeliveryRules plus tests, signing
- [ ] 7.2 Connected systems admin; parity run of `tmf-events`
- [ ] 7.3 Final acceptance checklist (15)
