# ADR-R12: Per-request `app_user_role` check and two sources of truth for system limits

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** ADR-07 (`09-target-architecture.md:42`), `04-security-and-tenancy.md:53,58`, `12-keycloak.md:6,13,25,44`, `10-data-mapping-cassandra.md:86-88`, `07-integrations.md:13-15`, BR-003, BR-115, invariant 1

## Context
Tokens carry `tenant` and `role`; "the Java side also checks an `app_user_role` table in Cassandra as the source of truth, and refuses the request if the token and the table disagree" (`04:53`, `12:44`). Connected systems become Keycloak confidential clients whose attributes hold `tenant_id`, `scopes`, `read_limit`, `write_limit` (`12:13`), while `integration_clients_by_key` also stores scopes and limits (`10:86-88`) and the admin screen edits them (`07:13-15`).

## Problem at scale
- One Cassandra read per request at LOCAL_QUORUM for every person and every system call: at 100+ systems near the read allowance plus the web app, this is the single hottest read path, and it adds Cassandra to the availability equation of every GET. The read itself is a single small partition (`user_id`), so the issue is latency and coupling, not partition size.
- "Refuse when they disagree": after an admin changes a user's role, the token still carries the old role until it expires (`12:25`), so the user is refused for that period rather than served with the new role. The pack does not say which of the two values the `CallerContext` uses when they agree only partly (same tenant, different role), nor what happens to a user whose row was deleted (should be refused at once, which argues for the table).
- Systems: Keycloak `service-<name>` clients with limits as client attributes and the application table with the same fields means two writers (Keycloak admin console, Admin > Connected systems) and no rule for which wins; BR-115 and the 429 message that points to Admin > Connected systems assume the application owns them.
- Hundreds of tenants as Keycloak groups and one role per user keep the token small (ADR-07); no token-size issue. Shared-service staff who work across countries cannot be modelled (BR-003, invariant 1): the pack should say so explicitly rather than leave it to the first support ticket.

## Options
**A. Table wins, cached per node.** The token authenticates; `CallerContext` takes tenant and role from `app_user_role`, cached per node with a TTL bounded by the token lifetime and invalidated by an outbox row on role change. Disagreement is logged, not refused, except when the row is missing or the tenant differs (refuse).
Trade-off: a per-node cache window for revocation unless the invalidation event is delivered; a small inconsistency between nodes.

**B. Token wins, table audits.** Use claims; a background job reconciles the table and reports drift.
Trade-off: role changes wait for token expiry; a compromised Keycloak mapping grants access the table never approved.

**C. Keycloak as the only source.** Drop the table; manage roles only in Keycloak.
Trade-off: contradicts ADR-07 and the admin screens that assign roles in the app; Keycloak admin API becomes a runtime dependency of the admin screens.

For systems: the application table is the owner of scopes and limits; Keycloak carries identity and `tenant_id` only; a new `integration_clients_by_keycloak_client` lookup table maps the token's `azp`/client id to the row.

## Recommendation (not a decision)
A, with the systems rule above. The owner decides whether a tenant mismatch between token and table is "refuse" (recommended) and whether role-only mismatch is "table wins" (recommended).

## Consequences for the rebuild
- `12:13` loses `scopes`, `read_limit`, `write_limit`; `12:44` is restated as "table is authoritative; token authenticates".
- A role-change command emits an outbox row consumed by every node's cache (ADR-R05 consumers).
- BR-003's single-tenant rule is recorded in `12` with the shared-service limitation named.

## What the prototype oracle currently does
- `loadRole` reads `user_roles` on every call (`src/services/seam-runtime.ts:30-33,72,91`); the TMF path reads `integration_clients` and its limits per request (`src/services/tmf-gateway.ts:84-95`); scopes and limits live only in the application table.
