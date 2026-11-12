# ERAD document management — rebuild handbook

This pack describes the current application (TanStack Start + Postgres) precisely enough to reimplement it on
**Java 21 / Spring Boot 3, Cassandra 5, OpenSearch, Keycloak and Angular** with identical behaviour.

## Reading order
1. `01-product-overview.md` — purpose, roles, telecom context
2. `02-domain-model.md` — entities and lifecycles
3. `03-business-rules.md` — numbered, testable rules (BR-xxx)
4. `04-security-and-tenancy.md` — isolation, access, audit
5. `05-screens/` — every page, its states, actions and copy
6. `06-api/` — internal API and TMF667 v4 API
7. `07-integrations.md`, `08-search-at-scale.md`
8. `09`–`13` — target architecture, Cassandra, OpenSearch, Keycloak, Angular
9. `14-non-functional.md`, `15-test-strategy.md`, `16-traceability.csv`
10. `17-kiro-steering/` — drop into `.kiro/steering` and `.kiro/specs`
11. `adr/` — review ADRs (proposals, owner's decision) from the 2026-11-12 multi-perspective review; the review itself is in `../review/2026-11-multi-perspective.md`

`contracts/` holds the JSON schemas and OpenAPI files; `fixtures/` holds synthetic seed data.

## Ground rules for the rebuild
- The current app is the reference implementation: when this pack and the app disagree, the app's tests decide. Exceptions are the places where the app contradicts an invariant; they are listed in `../review/2026-11-multi-perspective.md` and marked in this pack as "the reference does X; the rebuild must not copy it".
- Rules in `17-kiro-steering/invariants.md` must never change (tenant isolation, four-eyes, no document content in events, audit written only by operations).
- Done means: every BR id, screen and API operation in `16-traceability.csv` has a passing target test.

## Glossary
| Term | Meaning |
|---|---|
| Tenant | A country organisation (e.g. Sweden, Norway) under a master group (Aurora) |
| Record / business entity | External telecom object a document belongs to (order, quote, ticket, customer, account) |
| Document type / specification | TMF667 DocumentSpecification: required details, retention, sensitivity |
| Details / extraction fields | Values read from a document that a person confirms before approval |
| Four-eyes | The person who added a document cannot approve it |
| Legal hold | Blocks deletion and expiry regardless of retention |
| Connected system | External system (Order care, CPQ, CRM, Ticketing) using the TMF API |
