# 04 — Security and tenancy

## Current model (reference)
- Every table has row-level security. Screens read **as the caller**: policies in `reference/postgres-schema/0000_*.sql` and `0002`, `0006` call SECURITY DEFINER helpers.
- Writes go through server operations that use a privileged client **after** an explicit role and access check, and append their own audit event.
- Helpers:
  - `user_tenant()` returns the caller's single tenant.
  - `has_role(r)` checks the role in that tenant.
  - `my_parent_tenant()` and `is_my_child_tenant(t)` support group reads.
  - `entity_in_my_tenant(e)` is used by the entity_access policy, to avoid recursion.
  - `can_see_document(doc)` is the visibility rule (BR-090).
- The search builder `_doc_search_where` inlines the same rule so it can run against millions of rows.

### Visibility rule (must be identical in the rebuild)
```text
visible(doc, caller) :=
  doc.deleted_at IS NULL AND doc.purged_at IS NULL AND (
    ( doc.tenant = caller.tenant AND (
        caller.role = tenant_admin
        OR EXISTS entity_access(e, caller) for some e related to doc
        OR EXISTS share(doc, caller) not expired ))
    OR EXISTS cross_tenant_grant(doc, caller.tenant) not revoked, not expired )
```
- Relations, shares, versions, details and events of a document are visible only if the document is.
- Cross-tenant grants are listed only for managers and admins.
- Activity rows without a document are visible to tenant admins of that tenant.
- Records (business entities) are visible to a tenant_admin of that tenant, or to someone with `entity_access`.

### Group (master) access
- master_admin reads tenants that are its children, plus specifications and retention policies, for configuration.
- Documents are visible only as aggregate counts (`master_document_stats`). A master_admin never sees document rows, names or records of a child.
- Children read the group's specifications and retention policies (inheritance).

### Leak rules (regression-tested)
- **L1:** A Norway user's pages and server replies contain no Sweden record ids, names, document ids or document names. This holds for direct URLs too.
- **L2:** "Shared with me" never returns record names. It returns a record id only when the caller can read that record.
- **L3:** Removing a share removes access immediately, on the list and on direct links.
- **L4:** Activity entries for detail review store the field name, never its value.
- **L5:** Events carry references only (id, href, status).
- **L6:** Errors shown to people are typed keys plus a plain message. Raw backend errors are never shown.

### Audit
- Every operation writes `document_events` (append-only): register, update, version, statusChange, hold, delete, restore, purge, share, revoke, review, problem, and system actions with the client name.
- The client may add only `view` and `download` events.

### Four-eyes
`created_by == caller` blocks approval (BR-022), on both the server and the UI, and through the API. The API client's own registrations are attributed to the system, so the check uses the system's identity.

## Target mapping (Java / Keycloak / Cassandra / OpenSearch)
| Concern | Current | Target |
|---|---|---|
| Identity | Supabase auth session | Keycloak OIDC (Authorization Code + PKCE for Angular). The Spring resource server validates JWTs. |
| Tenant and role | `user_roles` row | Keycloak token claims `tenant` and `role` (one each), from a group `/tenants/<id>` and a realm role. The Java side also checks an `app_user_role` table in Cassandra as the source of truth, and refuses the request if the token and the table disagree. |
| Row-level security | Postgres policies | A `DocumentAccessService.canSee(doc, caller)` that implements the visibility rule. **Every** read path calls it, or uses a pre-filtered query. No repository is reachable from controllers without it (ArchUnit test). |
| Search visibility | `_doc_search_where` | OpenSearch bool filter on `tenant_id`, `visible_user_ids`/`visible_tenant_ids` and `deleted=false` (see `11-opensearch-index.md`). Results are re-checked with `canSee` before they are returned. |
| Privileged writes | service-role client after a check | Command handlers: check, then write with LWT where needed, then append the audit event in the same logical batch. |
| Group access | `is_my_child_tenant` | A `TenantHierarchyService`. The master endpoints return aggregates only, and DTOs with document fields are not allowed in the master module. |
| Connected systems | hashed keys + OAuth tokens | Keycloak confidential clients (client credentials), one per system. Tenant and scopes come from client attributes and mappers. A key-to-token compatibility shim is optional. |
| Downloads | signed URLs 300 s / 60 s | Object store pre-signed URLs with the same lifetimes, issued only after `canSee` and the content-lock check. |

## Security tests the rebuild must have
1. Visibility truth table. Every combination of role × record access × share (none, active, expired) × grant (none, active, revoked, expired) × deleted/purged must give the same result as `can_see_document`.
2. Response-body leak scan. Sign in as `no.manager`, call every endpoint with Sweden ids, and assert that no Sweden identifier appears in any body.
3. Master counts-only. Every master endpoint is checked for the absence of document names and ids.
4. Share removal takes effect immediately, including on cached search results.
5. Four-eyes is enforced in the UI, the internal API and the TMF API.
6. An ArchUnit rule: no controller depends on a repository directly.
