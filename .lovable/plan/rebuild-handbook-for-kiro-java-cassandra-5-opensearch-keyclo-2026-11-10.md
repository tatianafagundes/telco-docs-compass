# Rebuild handbook for Kiro: Java + Cassandra 5 + OpenSearch + Keycloak + Angular

## Goal
Write a documentation pack from the current app so Kiro can rebuild it without guessing. The pack covers the same behaviour, rules, screens, API and security, plus tests that prove the rebuilt app matches. It describes *what* the system does and *why*, and maps each part onto the new technology choices.

The pack goes in a new `docs/rebuild/` folder in the project, so it stays in step with the code. A ZIP copy goes in Files for handing to Kiro.

## What the pack contains

```text
docs/rebuild/
  00-README.md                 how to use the pack, reading order, glossary
  01-product-overview.md       purpose, personas, roles, telecom context (TM Forum SID, TMF667/630/688)
  02-domain-model.md           entities, fields, enums, relations, lifecycle diagrams
  03-business-rules.md         every rule as numbered, testable statements (BR-xxx)
  04-security-and-tenancy.md   tenants, master group, roles, record access, shares, four-eyes, audit
  05-screens/                  one file per screen: purpose, states, actions, copy, accessibility
  06-api/                      internal API (from the document seam) + TMF667 v4 API, errors, events
  07-integrations.md           connected systems, keys/OAuth, rate limits, event delivery and retries
  08-search-at-scale.md        search, facets, counts, paging, bulk jobs
  09-target-architecture.md    Java/Cassandra/OpenSearch/Keycloak/Angular mapping and decisions
  10-data-mapping-cassandra.md query-first tables, partition keys, consistency levels, TTLs
  11-opensearch-index.md       index mappings, analyzers, access filter, sync from Cassandra
  12-keycloak.md               realm, clients, roles/groups, token claims, service accounts
  13-angular-frontend.md       design tokens, component library, routing, state, a11y rules
  14-non-functional.md         performance targets, limits, retention, observability, privacy
  15-test-strategy.md          test pyramid, parity suite, fixtures, acceptance criteria
  16-traceability.csv          rule -> source file -> current test -> target test
  17-kiro-steering/            Kiro steering files and a spec-driven task list
  contracts/                   copies of the JSON schemas and both OpenAPI files
  fixtures/                    synthetic seed data as JSON (tenants, users, records, documents)
```

## What each part covers

1. **Product and roles:** what problems it solves for telecom teams (order care, CPQ, CRM, ticketing). It lists the six roles and a who-can-do-what matrix, generated from the current rules.
2. **Domain model:**
   - **What's covered:** tenants, business records, documents, versions, extracted details, document types, retention policies, holds, shares, audit events, connected systems, event outbox and deliveries, saved views and bulk jobs.
   - **Diagrams:** the status path (draft → in review → approved → effective → superseded/expired → archived) and the processing path.
3. **Business rules catalogue:** about 120 numbered rules, taken from the pure rule files. Each rule is one sentence with its inputs, its output, and the user-facing reason text. Rules are grouped as:
   - status changes and the approve gate
   - four-eyes, delete blockers, holds and keep-until dates
   - group locks and hard floors
   - upload checks and detail confirmation
   - search visibility
   - rate limits and event retries
4. **Security and tenancy:**
   - **Isolation:** country isolation and the master group seeing counts and settings only.
   - **Access sources:** record-level access, direct shares, and cross-country shares.
   - **Hard rules:** "never leak record names", and which actions are audited.
   - **Mapping:** how each database access rule maps onto Keycloak plus service-layer checks, and the OpenSearch query filters.
5. **Screens:** for each page, the layout at desktop and 792px, empty, loading and error states, the exact English copy, keyboard and focus behaviour, and an annotated screenshot.
6. **APIs:**
   - **Internal API:** every operation with request, response, error codes and idempotency.
   - **TMF667 v4:** standard operations vs our extensions, status mapping, event names, signature format, the 429 and Retry-After behaviour, and the old-address sunset.
7. **Target architecture (Java):** I propose Spring Boot 3 / Java 21 unless you say otherwise.
   - **Modules:** document, tenant, access, search, integration and events.
   - **Data flow:** Cassandra is the source of truth and OpenSearch holds the index. An outbox moves changes from one to the other.
   - **Security:** Keycloak access tokens are checked as an OAuth2 resource server, with a separate client for connected systems.
   - **Architecture decision records:** about 10 short ones, for example "why an outbox", "why per-subscriber delivery" and "how to emulate transactions without SQL".
8. **Cassandra data model:** query-first tables for each screen and API call, with partition and clustering keys and counters for rate limits. It also covers:
   - lightweight transactions for idempotency keys and status changes
   - TTLs for tokens and download links
   - append-only audit and versions
   - what has to change because Cassandra has no joins or row-level security
9. **OpenSearch:** document index mapping (full text, facets, tenant and visibility fields), keyset paging with `search_after`, capped counts, facet aggregations, and reindex and sync rules.
10. **Keycloak:** realm per environment, roles vs groups for tenants, claims the API needs (user id, tenant, role), the demo users, and OAuth client credentials replacing the current system keys.
11. **Angular:** port the design tokens, list the reusable components, and keep the rules (e.g. unavailable buttons stay focusable and show a reason). It also covers routes, guards, the state approach and i18n readiness.
12. **Non-functional targets:** millions of documents, search response times, the 10,000 bulk limit, 120/30 per-minute defaults, the event retry schedule, the 5 MB/25 MB file limits and the 12-month key expiry.

## Test suggestions for Kiro

- **Parity suite (most valuable):**
  - Turn the current regression scripts into language-neutral scenarios in Given/When/Then form: the TMF API, notifications, rate limits and share isolation.
  - Both apps run the same scenarios. The current app is the reference; the new one must match.
- **Rule tests:** one JUnit test per BR-xxx rule, using the same example values as today's tests (about 130 tests).
- **Contract tests:** validate responses against both OpenAPI files and the official TMF667 v4 Swagger.
- **Isolation tests:**
  - Sweden can never see Norway, and the master group gets counts only.
  - Removed shares stop working straight away.
  - Every server reply is scanned for leaked identifiers.
- **Integration tests:** Testcontainers for Cassandra 5, OpenSearch and Keycloak, covering outbox to index sync, per-subscriber retries, and no duplicate deliveries when delivery runs overlap.
- **Interface tests:** Playwright for the key journeys (sign in, upload, check details, approve, share, legal hold), plus automated accessibility checks and 792px layouts.
- **Load tests:** a seed of 1–5 million documents and the search, facet and bulk targets.
- **Acceptance checklist:** every rule, screen and API operation is ticked off against the traceability file.

## Kiro hand-off
- **Steering files:** product, tech stack, structure, and "rules you must not change" (tenant isolation, four-eyes, no content in events, audit only from operations).
- **Specs:** a phased task list in Kiro's requirements → design → tasks style. The phases are the foundation and identity, documents core, details and approval, holds and retention, search, TMF API, then events and connected systems.

## Questions to settle during writing (defaults in brackets)
- Java framework [Spring Boot 3, Java 21]
- One Keycloak realm or one per country [one realm, tenant as a group plus claim]
- Kiro steering format [Kiro's `.kiro/steering` and `.kiro/specs` layout]

## Technical details
- **Sources:**
  - rule files in `src/services/*-rules.ts` and `document-actions.ts`
  - server functions and the TMF gateway
  - database migrations, schemas and both OpenAPI files
  - routes in `src/routes`, the e2e scripts, and `AGENTS.md`
- **Generation:**
  - the role matrix and rule catalogue are read from the code
  - screenshots come from a Playwright capture script
  - the traceability CSV links each rule to its file and test
- **Checks before hand-off:**
  - every rule file and API operation appears in the catalogue
  - links resolve
  - the ZIP contents are listed and inspected
  - no secrets, keys or personal data are included (synthetic demo data only)
