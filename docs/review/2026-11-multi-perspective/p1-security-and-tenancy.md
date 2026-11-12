# P1 — Security and tenancy review of the Lovable prototype (oracle for the Angular/Java rebuild)

Repository: `/Users/earatat/telco-docs-compass`, branch `review/multi-perspective-2026-11`. Static review only; the hosted Supabase was not called, no e2e was run, no file was edited.

## 1. Scope and method

The `security-review` skill refused to run because the session's working directory is not the git repository; its method was applied by hand: (a) map the trust boundaries (browser → TanStack server functions with the caller's JWT; server functions → service-role client; connected systems → TMF gateway with hashed keys; scheduler → cron routes with `LOVABLE_CRON_SECRET`; database with RLS and SECURITY DEFINER helpers; private storage bucket), (b) trace every read and write path across those boundaries, (c) compare each path with the written rules, (d) look for what the rules do not say.

Targets read in full: the 16 migrations in `drizzle/migrations/`; `src/services/seam-runtime.ts`, `document.functions.ts`, `document-write.functions.ts`, `retention.functions.ts`, `search.functions.ts`, `tenant-config.functions.ts`, `integration-clients.functions.ts`, `pipeline.functions.ts`, `bulk-worker.ts`, `tmf-gateway.ts`, `tmf-events.ts`, `event-delivery-rules.ts`, `rate-limit-rules.ts`, `document-actions.ts`, the helpers in `tmf667-mapper.ts`, `api.ts`; every route under `src/routes/api/`; `src/integrations/supabase/client.server.ts`, `auth-middleware.ts`, `cron-auth.ts`; `src/components/search/search-url.ts`; `src/schemas/document.ts`; `src/routes/_authenticated/admin.tenants.$tenantId.tsx` and `shared.$docId.tsx`.

Judged against: `docs/rebuild/04-security-and-tenancy.md` (visibility rule, L1–L6, audit), `docs/rebuild/17-kiro-steering/invariants.md` (1–12), `docs/rebuild/03-business-rules.md` (BR-004, BR-022, BR-083, BR-090–096, BR-124, BR-126, BR-136, BR-137, BR-140), and the kit `AGENTS.md` sections "Product rules" (rules 3, 5, 6, 7, 8) and "Never".

Already known, confirmed in one line each:
- Demo password literal present in 5 files (`e2e/share-isolation.py`, `e2e/tmf-rate-isolation.py`, `e2e/tmf-api.py`, `src/services/__tests__/share-isolation.integration.test.ts`, `src/services/__tests__/access.integration.test.ts`); value not reproduced here.
- 12 `.delete()` calls in app code (retention 3, pipeline 2, tmf-gateway 2, seam-runtime 1, document-write 1, search 1, tenant-config 1, integration-clients 1).
- Search text `q` in the page URL (`src/components/search/search-url.ts:24`), together with `entityId`, `rec` and `doc` ids.
- Service-role client only in `src/integrations/supabase/client.server.ts`, created lazily from `process.env` and loaded through `await import(...)` inside handlers; `.env` (committed) holds only the publishable key and URL.

Verdicts: **BLOQUEIA** = the rebuild would inherit a tenant/data leak or an invariant break; **CORRIGIR** = wrong but contained; **NOTA** = observation.

## 2. Findings (ordered by severity)

### B1 — BLOQUEIA — Share level and the document's tenant are never enforced on writes; "can see" is the only gate before privileged writes
- **Where:** `src/services/seam-runtime.ts:119-126` (the only access check is `can_see_document`); `src/services/document-write.functions.ts:66-69` (`loadDoc` selects by id only, no `tenant_id`), and every write that relies on it: `updateMetadata` :203-206, `addVersion` :241-246, `transition` :363-367 (including `to: "approved"`), `setHold` :392-405 (no document load at all), `deleteDocument` :420-438, `reportProblem` :477-486, `grantAccess` :497-523, `revokeAccess` :534-544, `reviewExtraction` :607-612. Contrast with the paths that do pin the tenant: `pipeline.functions.ts:33-40` ("Seeing a document (e.g. through a share) is not enough"), `bulk-worker.ts:25-30`, `retention.functions.ts:184-189`, `restoreDeleted` :453-454.
- **Contradicts:** Invariant 1 (tenant isolation), BR-004 (a `view` share caps at viewer; reviewing, approving and managing access need record access), BR-091 (cross-tenant share needs the *owner* tenant's `explicitGrant`), kit rule 5 ("Data never crosses tenants"), 04 §Current model ("after an explicit role and access check").
- **Evidence:** `can_see_document` returns true for an unexpired `document_access_exceptions` row of any level and for an unrevoked `cross_tenant_grants` row of any level (`0000:250-264`). The level is stored but read by no server write. `env.role` is the caller's role *in their own tenant*. So a Norway `manager` holding a `view` grant on a Sweden document may: rename it, add a version, approve it (`transition`, four-eyes only checks `created_by`), place or release a legal hold, soft-delete it, review its extracted details, and share it on to Norway users or to *any* tenant (`grantAccess` checks `cross_tenant_share` of the caller's tenant at :511-512, not of the document's tenant). The only cap, `sharedOnlyRole` (BR-004), lives in `document-actions.ts:84-87` and is applied in the UI from a URL parameter: `src/routes/_authenticated/shared.$docId.tsx:10-11` — `validateSearch: z.object({ level: z.enum(["view", "edit"]).catch("view") })` with the comment "the server checks every action itself", which is not true.
- **Consequence for the rebuild:** the command handlers would be specified as "canSee(doc, caller) AND role(caller) ≥ capability ⇒ allowed", which makes a view-only share equivalent to full membership and lets a granted tenant act on, and re-share, another tenant's documents. The rebuild needs an `effectiveRole(doc, caller)` that (i) applies the share/grant level cap server-side, (ii) requires `doc.tenant == caller.tenant` for every state, hold, delete, review and share operation, and (iii) checks the *owner* tenant's `cross_tenant_share`.

### B2 — BLOQUEIA — Related record ids and types are returned for documents visible only through a share or a cross-tenant grant
- **Where:** `drizzle/migrations/0009_document_search_at_scale.sql:99-110` (`search_documents` selects `rel.entity_id` and `be.referred_type` unconditionally; only `be.display_name` is gated by `entity_access`/tenant_admin); `src/services/document-write.functions.ts:88` (`find` embeds `document_relations(entity_id, role)` for every visible document); `0011:24` (`_doc_search_where` matches `r2.entity_id ILIKE '%q%'`, so the search box is a prefix oracle for record ids of related records the caller may not open). The UI renders these rows as "Record you can't open" (`src/components/search/results-table.tsx:122`), so the id is in the server reply and in the DOM.
- **Contradicts:** L1 (no Sweden record ids in a Norway user's server replies), BR-093 / Invariant 4 (shared-only access never leaks record details; a record id only when the caller can read that record). `listSharedWithMe` (`document.functions.ts:201-208`) does it correctly; search and `find` do not.
- **Evidence:** `0009:102` `rel.entity_id,` and `:104` `be.referred_type` outside the `CASE WHEN %s` that protects the name.
- **Consequence for the rebuild:** `11-opensearch-index.md` would carry `entity_id` on the document and the search DTO would return it for every visible hit, so the "shared with me" protection would exist on one list and be undone by search. The rebuild's search DTO must gate `entityId` and `entityType` with the same record-access test as `entityName`, and record-id text matching must be restricted to records the caller can open.

### C1 — CORRIGIR — Search RPCs left executable by PUBLIC (and so by `anon`)
- **Where:** `0009:112,122,133` (`search_documents`, `count_documents`, `facet_documents`), `0010:9` (`search_document_ids`): `GRANT EXECUTE ... TO authenticated` with no `REVOKE ... FROM PUBLIC`. `0000:321-323` states the rule and applies it only to functions existing at that time; `0011:53` and `0012:38`, `0014:37` follow the rule, 0009/0010 do not.
- **Contradicts:** Never-list "no table, view or function granted to `anon`; no function left executable by `public`".
- **Evidence:** `_doc_search_where` returns `'false'` when `user_tenant()` or `auth.uid()` is null (`0011:12`), so an anonymous call returns no rows — contained, but the SECURITY DEFINER entry point is reachable without a session.
- **Consequence for the rebuild:** none directly (Keycloak replaces PostgREST), but the oracle's grant pattern should not be copied into any SQL the rebuild keeps.

### C2 — CORRIGIR — URL-attachment and callback SSRF guard is a DNS-over-HTTPS pre-check, then a separate fetch (TOCTOU / rebinding), with buffering before the size cap
- **Where:** `src/services/tmf-gateway.ts:322-337` (`resolvesPublic` asks `cloudflare-dns.com`), `:339-351` (`fetchBytes` then calls `fetch(url)` which resolves again), `:344-347` (full `arrayBuffer()` before checking 25 MB when `content-length` is absent); `src/services/tmf-events.ts:89-97` (same pattern per delivery, cached per callback for the pass); `tmf667-mapper.ts:490-494` (`isPrivateIp` misses NAT64 `64:ff9b::`, long-form `0:0:0:0:0:ffff:…`, and treats any `::ffff:` as private without checking the embedded v4).
- **Contradicts:** BR-137 ("a DNS check that rejects private addresses") is literally met, but the check does not bind the connection; spec gap.
- **Evidence:** `const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });` after `if (!(await resolvesPublic(url))) return null;`.
- **Consequence for the rebuild:** the Java side would copy "resolve, check, then connect" and remain open to rebinding; it needs connect-time IP pinning or an egress allowlist, a streamed size limit, and no dependency on a third-party resolver. `redirect: "error"`, https-only and the private-range list are good and should be kept.

### C3 — CORRIGIR — TMF DELETE ignores the group's minimum-retention floor
- **Where:** `src/services/tmf-gateway.ts:554-556` uses `deleteState("manager", legal_hold, retain_until, today)`; the app's `deleteDocument` (`document-write.functions.ts:424-437`) also applies `hard_floors.minRetentionDays` of the parent tenant through `deleteBlocker` (`document-rules.ts:125-139`).
- **Contradicts:** Invariant 8 ("retention beats deletion"), BR-083 spirit (group floors are hard).
- **Consequence:** a connected system could soft-delete a document the app refuses to delete; the rebuild would carry two delete rules. One rule, applied in both channels.

### C4 — CORRIGIR — Content hash of app uploads is asserted by the browser and never verified; `verifyHolds` reports it as evidence
- **Where:** `document-write.functions.ts:172` and `:293` (`content_hash: data.contentHash ?? ""` — an empty hash is accepted on `addVersion`), `pipeline.functions.ts:57-62` (reads the stored bytes but never hashes them), `retention.functions.ts:154-173` ("Verify hold" report lists `content_hash`). The TMF path verifies inline and url bytes (`tmf-gateway.ts:390-391`) but not the upload-address flow.
- **Contradicts:** Invariant 9 / kit rule 3 (versions immutable: "a version without a hash is not a version", `0000:193`); the signed-upload ticket lets any bytes land under a pre-recorded hash.
- **Consequence:** the rebuild would reproduce a legal-hold integrity report built on untrusted hashes. Compute the hash server-side when the object lands (or when the pipeline reads it) and refuse a mismatch.

### C5 — CORRIGIR — Document name placed in the signed download URL
- **Where:** `document-write.functions.ts:344` `createSignedUrl(path, seconds, { download: doc.name })` → the URL carries `?download=<document name>`; names default to the uploaded file name.
- **Contradicts:** Never-list "never put search text or a file name in a URL".
- **Consequence:** the rebuild's pre-signed URL would carry `response-content-disposition=<name>` into proxy and browser logs. Set the disposition on the response side or use an opaque name.

### C6 — CORRIGIR — `resetTestData` purges without audit and with different tombstone semantics than `purge`
- **Where:** `src/services/pipeline.functions.ts:76-119`: hard-deletes `document_relations` (:105), sets `deleted_at/purged_at` (:106), removes files, deletes idempotency keys (:116); writes no `document_events`; leaves `extraction_fields`, `document_access_exceptions`, `cross_tenant_grants`, `description` and `characteristic` in place (purge removes them: `retention.functions.ts:196-206`). Also builds a PostgREST `.or()` filter by string interpolation (:86).
- **Contradicts:** Invariant 9 ("audit is written by the operation itself"), Invariant 8 (tombstone definition), kit "never hard-delete from app code".
- **Evidence:** contained by `r.role === "master_admin"` and the `aurora-` prefix guard (:88).
- **Consequence:** harmless in the prototype; must not become the rebuild's "test reset" semantics.

### C7 — CORRIGIR — Expired system keys keep receiving signed events
- **Where:** `src/services/tmf-events.ts:33-37` filters subscriptions by `integration_clients.revoked_at IS NULL` only; `expires_at` is checked for API calls (`tmf-gateway.ts:85-88`) and tokens, not for deliveries. Revocation deletes subscriptions (`integration-clients.functions.ts:134`); expiry does not.
- **Contradicts:** BR-136 (keys last 365 days) as the lifetime of the integration.
- **Consequence:** the rebuild's Keycloak client expiry would need the same rule on the subscription side; specify "subscription lifetime = client lifetime".

### C8 — CORRIGIR (owner's decision) — `master_document_stats(text)` ignores the child's `master_supervision` setting
- **Where:** `0004:5-17` (function, used by `tenant-config.functions.ts:142-150` for `listChildTenants` and `getChildView`) has no supervision test; the view `0000:310-316` requires `c.master_supervision <> 'none'` with the comment "the CHILD's setting governs". The UI uses the function.
- **Contradicts:** spec gap — `02-domain-model.md:18` lists the enum, no BR defines its effect; `0000` and `0004` disagree.
- **Consequence:** counts only (Invariant 2 holds), but the rebuild would drop a child's "none" setting silently or keep an unused field. Decide: does `none` hide counts from the group?

### C9 — CORRIGIR — Idempotent replay is served before the visibility re-check
- **Where:** `src/services/seam-runtime.ts:101-117` (replay) precedes `:119-126` (`can_see_document`).
- **Contradicts:** BR-094 / L3 nuance (removing a share takes effect immediately): for 24 h (`IDEMPOTENCY_TTL_HOURS`) the same actor can replay the same key and body and receive the stored response, which for `updateMetadata`/`transition`/`setHold` is the full document row (`loadDoc`). Same actor and same tenant only (`PK (tenant_id, actor, key, operation)`), so contained.
- **Consequence:** the rebuild should either check access before replay or store only an opaque outcome reference.

### N1 — NOTA — Any tenant id is a valid grant target, with an existence oracle through the admin client
- `document-write.functions.ts:513-514` looks up `tenants` with the service role; `access.subject.notFound` vs success tells a manager whether a tenant id exists anywhere in the system, and BR-091 allows a grant to any other tenant (not only the group). Spec gap: owner's decision whether targets are limited to the group or to configured partners.

### N2 — NOTA — `can_see_document` omits `purged_at`
- `0000:254` tests `deleted_at` only; the spec rule (04 §Visibility) and `_doc_search_where` (`0011:16`) test both. Equivalent today only because `purge` sets both (`retention.functions.ts:205`). The rebuild's `canSee` must test both explicitly (Invariant 3: one rule).

### N3 — NOTA — Free text in audit detail, and it crosses tenants on granted documents
- Hold reasons and references are copied into `document_events.detail` (`document-write.functions.ts:408`, `tmf-gateway.ts:610`, `bulk-worker.ts:76`); `0000:343` says "a code plus a reference, never free text", kit rule 8 "action + short detail only". `listActivity` (`document.functions.ts:141-153`) returns those details to anyone who can see the document, including a cross-tenant grantee. L4/L5 are respected (no field values), so NOTA.

### N4 — NOTA — Audit rows for actions on a granted document carry the actor's tenant, not the document's
- `seam-runtime.ts:47-55`, `document.functions.ts:134-137`: `tenant_id: env.tenantId`. A Sweden document's trail gains rows with `tenant_id = norway`. The rebuild's audit partition key needs a decision (document tenant, with actor tenant as a field).

### N5 — NOTA — Sequences readable by every authenticated user
- `0001:4` `GRANT USAGE, SELECT ON ALL SEQUENCES ... TO authenticated` exposes `document_events_id_seq` / `event_outbox_id_seq` values (global activity volume across tenants). Lovable-generated; no row data.

### N6 — NOTA — Event hrefs and the TMF `origin` come from the request's Host header
- `tmf-events/deliver.ts:13` and `tmf-gateway.ts:105` use `new URL(request.url).origin`; a scheduler calling an internal name would sign events with internal hrefs. The rebuild should use a configured public base URL.

### N7 — NOTA — Outbox trigger: purge emits a change event, restore emits nothing
- `0007:48-65`: purge clears `characteristic` so `DocumentAttributeValueChangeEvent` fires for a tombstone; `deleted_at → null` matches no branch. BR-127 spec gap (no restore event defined).

### N8 — NOTA — Token endpoint and key messages
- `tmf-gateway.ts:87` distinguishes "This system key has expired" from "not valid" (existence oracle on a 240-bit key; negligible). `/oauth/token` is outside the per-system rate limit, `client_id` is ignored (:698-707), token rows are only pruned on issue (:715). Keys and tokens are SHA-256 hashed; subscription HMAC secrets are stored in clear (`0007:27`) because they must be recoverable — the rebuild should encrypt them at rest.

### N9 — NOTA — Two tenant columns per user with no consistency constraint
- `profiles.tenant_id` (`0000:29-33`) and `user_roles.tenant_id` (`:35-41`); `user_tenant()` reads `user_roles`, `profiles_tenant` reads `profiles`. `user_roles_guard` only guards master_admin placement. The rebuild's "token claims vs `app_user_role` table" check (04 §Target) should keep one source of truth for display names too.

### N10 — NOTA — Bulk by selected ids resolves visibility against the newest 1001 visible documents only
- `search.functions.ts:210-212`: `search_document_ids({}, BULK_LIMIT + 1)` then `ids.filter(visible.has)`; a selected document older than the cap is silently dropped as invisible. Also `actor_role` is frozen at job creation (`0009:155`, `bulk-worker.ts:58`). Tenancy-adjacent correctness.

### N11 — NOTA — Unverifiable from the repo
- "Sign-ups disabled" and the private `documents` bucket are dashboard state (`supabase/config.toml` holds only `project_id`; no `storage.objects` policy exists in the migrations, which is the intended state). The rebuild must make both explicit in configuration under version control.

## 3. Disposition

| # | Verdict | Fixable in this branch (docs/tests only) | Goes to the rebuild | Owner's decision |
|---|---|---|---|---|
| B1 | BLOQUEIA | Add to 04 an "effective role on a document" rule and a truth-table test spec (share level × grant level × own role × doc tenant); mark `shared.$docId.tsx` comment as wrong in the review notes | Yes: server-side `effectiveRole`, tenant pin on every write, owner-tenant `cross_tenant_share` check | Whether a cross-tenant `edit` grant may ever change state or hold (today: spec says only view/edit levels exist) |
| B2 | BLOQUEIA | Extend L1 test spec: search and `find` replies for `no.manager` must contain no Sweden `entity_id`/`entity_type`; add to 11-opensearch-index.md that `entityId` is gated like `entityName` | Yes: gate `entityId`/`entityType`, restrict record-id text match | Whether a shared-only document should show "Record you can't open" at all (UI copy exists) |
| C1 | CORRIGIR | Note in 04 the "revoke from PUBLIC first" rule for any SQL kept | No (Keycloak replaces PostgREST) | — |
| C2 | CORRIGIR | Rewrite BR-137 to "connect-time private-address rejection, streamed 25 MB cap, no third-party resolver" | Yes | Egress allowlist vs IP pinning |
| C3 | CORRIGIR | State in 03 that BR-083 floors apply to TMF DELETE | Yes: one delete rule for both channels | — |
| C4 | CORRIGIR | State in 04/03 that hashes are computed server-side on landing; `verifyHolds` reports only verified hashes | Yes | Whether an unverified version may be opened before the pipeline hashes it |
| C5 | CORRIGIR | Add to 04 §Downloads: disposition set on the response, name never in the URL | Yes | — |
| C6 | CORRIGIR | Document that `resetTestData` is prototype-only and not a seam operation | No (do not port) | Keep a test reset in the rebuild at all? |
| C7 | CORRIGIR | Add to BR-136: subscriptions end with the client | Yes | — |
| C8 | CORRIGIR | Define `master_supervision` effect in 03 | Yes once decided | Does `none` hide counts from the group? |
| C9 | CORRIGIR | Add to the seam contract: access check precedes replay, or replay returns an outcome reference | Yes | — |
| N1 | NOTA | — | Maybe | Limit grant targets to group/partners? |
| N2 | NOTA | Add `purged_at` to the rule text in 04 (already there) and to the truth table | Yes | — |
| N3 | NOTA | Clarify kit rule 8 on hold reasons | Maybe | Keep hold reason in audit or in the document only? |
| N4 | NOTA | Define audit partition key in 04 §Audit | Yes | Document tenant vs actor tenant |
| N5 | NOTA | — | No | — |
| N6 | NOTA | Note in 04 §Connected systems: configured base URL | Yes | — |
| N7 | NOTA | Add restore event (or explicit "none") to BR-127 | Yes | Emit a restore event? |
| N8 | NOTA | Note: encrypt subscription secrets at rest | Yes | — |
| N9 | NOTA | — | Yes (single source of truth) | — |
| N10 | NOTA | Test spec: bulk by ids must not drop old visible documents | Yes | — |
| N11 | NOTA | Add to 04: sign-up and bucket policy as versioned config | Yes | — |

## 4. Verified as correct

- Tenant never comes from a URL, header or body in server functions; the one input tenant (`getChildView`, `admin/tenants/$tenantId`) is checked as the caller: `master_admin` and `parent_tenant_id = env.tenantId`, same `tenant.notFound` for missing and not-yours (`tenant-config.functions.ts:189-197`).
- Cron routes (`/api/public/tmf-events/deliver`, `/api/public/jobs/bulk-documents`): bearer compared as SHA-256 digests with `timingSafeEqual`, fail-closed (500) when the secret is unset, previous-secret rotation supported (`cron-auth.ts`).
- System keys and OAuth tokens stored as SHA-256 only; `readBearer` regex; 15-minute tokens; key `expires_at` and `revoked_at` checked in `authenticate` and `issueToken`; scopes checked, including the PATCH status-only peek (`tmf-gateway.ts:463-493`); approval scope separate from transition.
- Per-system rate limit is atomic (`api_hit`, SECURITY DEFINER, service_role only), counted per client even when called through a token; headers and `Retry-After` set (Invariant 11).
- Idempotency keys scoped by `(tenant_id, actor, key, operation)` for both the app (`actor = user`) and TMF (`actor = client`); mismatch gives `seam.idempotency.mismatch` / 409 `idempotencyMismatch`.
- Storage: object key `<tenant_id>/<version_id>` (never the file name) in all three paths; private bucket, no `storage.objects` policy in SQL; uploads only via signed upload URLs; downloads 300 s preview / 60 s download (app) and 60 s (TMF); content-lock states identical in both channels (`scanning`, `quarantined`).
- Events carry references only (`toTmfEvent`), are signed as `sha256=HMAC(secret, "<ts>.<body>")` with `X-Signature-Timestamp` and a stable `X-Event-Id`; the reference verifier rejects timestamps beyond 300 s and compares in constant time; subscriptions are same-tenant with a defence-in-depth tenant check per delivery; callbacks are https-only, DNS re-checked per pass, `redirect: "error"`, 5 s timeout; deliveries claimed with `SKIP LOCKED` (BR-124–126, Invariant 10).
- RLS enabled on every table; no `using (true)`; nothing granted to `anon`; service-only tables (`idempotency_keys`, `event_subscriptions`, `event_outbox`, `event_deliveries`, `api_rate`, `integration_tokens`) have no policy for `authenticated`; `tenants_read` is sibling-safe; `grants_read` limited to manager/admin; events without a document visible to `tenant_admin` only; `master_document_stats` is the only `security_invoker = false` view; `effective_specifications` gated to own tenant, master-of-child or `service_role`.
- Master paths return counts and settings only (`listChildTenants`, `getChildView`, `specUsage`); no master path selects document rows (Invariant 2).
- `listSharedWithMe` returns a record id only when the record is readable and never a record name (BR-093); revoking a user share hard-deletes the exception and revoking a tenant grant sets `revoked_at`, both honoured by `can_see_document` and `_doc_search_where` (BR-094).
- Four-eyes in the app (`isOwnDocument`) and over the API (`registered_by_client`, 409 `fourEyesRequired`); required-detail gate before approval in both channels (Invariants 5, 6).
- Logging: `logOp` writes only op, tenant, document id, status and duration; TMF logs client, tenant, scope and request id; no body, token, signed URL, search text or file name is logged.
- Every server function validates input with zod; TMF bodies are size-capped and schema-checked, PATCH with `.strict()`; `findDoc` validates the uuid before querying.
- Purge: admin-only, blocked by hold and retention, removes files, extracted values, exceptions and grants, writes a `purge` event; `restoreDeleted` checks tenant and record access.
- Browser code never calls Supabase tables directly (no `supabase.from`/`rpc` outside `src/services`); uploads use `uploadToSignedUrl` only; no realtime subscription exists in client code despite `documents` being in the publication.
