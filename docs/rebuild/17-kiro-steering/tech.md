---
inclusion: always
---
# Tech stack

## Stack
- **Backend:** Java 21 and Spring Boot 3 (web, security resource server, validation, actuator), structured as a modular monolith (`docs/rebuild/09-target-architecture.md`).
- **Database:** Cassandra 5 is the source of truth. It uses query-first tables, logged batches and LWT (`10-data-mapping-cassandra.md`).
- **Search:** OpenSearch serves all search, counts, facets and bulk ids, with the access filter in every query (`11-opensearch-index.md`).
- **Identity:** Keycloak, with one realm, tenants as groups, a single role per user, and client-credentials clients for connected systems (`12-keycloak.md`).
- **Frontend:** Angular with standalone components, signals and keycloak-angular. Use only ported ERAD design tokens (`13-angular-frontend.md`).
- **Files:** S3-compatible object storage, keyed `<tenant>/<versionId>`, with pre-signed links of 300 s for preview and 60 s for download.

## Tests
JUnit 5, Testcontainers, ArchUnit, RestAssured, OpenAPI validation, Playwright plus axe, and k6 (`15-test-strategy.md`).

## Conventions
- Pure rule classes (`*Rules`) have no I/O and are ported 1:1 from `docs/rebuild/reference/rules/`.
- Every new rule gets a JUnit test with values that match `reference/rule-tests/`.
- Internal errors use `SeamError`; the TMF API returns the TMF Error object. Raw exceptions never reach clients.
