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
- Relations, shares, versions, details and events of a document are visible only if the document is. Related record ids and record types follow the same rule as record names (BR-093): a reply carries them only when the caller can read that record. The reference's `search_documents` (`0009:99-110`) and `find` (`document-write.functions.ts:88`) return `entity_id` and `referred_type` for every visible document, including shared-only and cross-tenant-granted ones, and `_doc_search_where` (`0011:24`) matches search text against record ids of records the caller cannot open; the rebuild must not copy this (review 2026-11-12, P1-B2).

### Effective role on a document (writes; must be enforced server-side)
Visibility (`canSee`) says whether a document may be read. It is not enough for a write. For every state change, hold, delete, restore, detail review and share operation the server also checks:
- `doc.tenant == caller.tenant` for state, hold, delete, review and share operations; a document seen through a cross-tenant grant can be read and downloaded at the grant level, never changed or re-shared.
- The share or grant level caps the role (BR-004): a `view` share gives viewer, an `edit`/`manage` share gives at most contributor; the cap is computed from the stored share row, never from a URL parameter.
- Sharing to another tenant checks the **document's** tenant `cross_tenant_share = explicitGrant` (BR-091), not the caller's.
The reference enforces none of these: `runWrite` checks only `can_see_document` (`seam-runtime.ts:119-126`), `loadDoc` selects by id without `tenant_id` (`document-write.functions.ts:66-69`), and the cap lives in the UI from `?level=` (`shared.$docId.tsx:10-11`). Review 2026-11-12, P1-B1.
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
`created_by == caller` blocks approval (BR-022) on both the server and the UI. Over the TMF API (BR-140), a system key cannot approve a document it registered itself (`documents.registered_by_client`); the reply is 409 `fourEyesRequired`. Another key or a person in the app can approve it.

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
| Downloads | signed URLs 300 s / 60 s | Object store pre-signed URLs with the same lifetimes, issued only after `canSee` and the content-lock check. The document name is set as the response disposition, never as a URL parameter (the reference puts `?download=<name>` in the URL, against the kit's Never list). |
| Content hash | asserted by the browser on upload (`contentHash` in `register`/`addVersion`, never verified; empty accepted) | Computed server-side when the object lands or when the pipeline reads it; a mismatch is refused. "Verify hold" reports only verified hashes. |
| URL attachment and callback checks | DNS-over-HTTPS pre-check, then a separate `fetch` (rebinding window); full buffering before the 25 MB cap | The private-address check binds the connection (resolve inside the connection or pin the resolved address); the size cap is applied while streaming; no third-party resolver. Egress allowlist versus address pinning is the owner's decision. |

## Security tests the rebuild must have
1. Visibility truth table. Every combination of role × record access × share (none, active, expired) × grant (none, active, revoked, expired) × deleted/purged must give the same result as `can_see_document`, which must test `purged_at` explicitly (the reference's function tests `deleted_at` only). A second table covers writes: share level × grant level × own role × document tenant → allowed operations, per "Effective role on a document".
2. Response-body leak scan. Sign in as `no.manager`, call every endpoint with Sweden ids, and assert that no Sweden identifier appears in any body, including `entityId`/`entityType` in search and `find` replies for shared-only documents.
2b. Four-eyes on every approval path: UI transition, TMF PATCH/transition, and bulk approve (the reference's bulk path never checks the creator, `search-rules.ts:124-144`, `bulk-worker.ts:27`).
3. Master counts-only. Every master endpoint is checked for the absence of document names and ids.
4. Share removal takes effect immediately, including on cached search results.
5. Four-eyes is enforced in the UI and the internal API, and in the TMF API (BR-140).
6. An ArchUnit rule: no controller depends on a repository directly.
