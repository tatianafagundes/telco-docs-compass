# Review pass 4: contracts and API

Prototype: `/Users/earatat/telco-docs-compass`, branch `review/multi-perspective-2026-11` (read only; nothing in the repo was edited by this pass; the modified `src/services/__tests__/*.test.ts` in `git status` belong to another pass).
Edited: `/Users/earatat/Library/CloudStorage/OneDrive-Ericsson/SPM/DXP/dxp studio vision - lovable like/contracts/seams/internal.openapi.yaml` only (2365 -> 2590 lines, 33 operations unchanged). Backup of the original: `(session scratchpad, not kept)`. The sibling `document.openapi.yaml` is still byte-identical to the repo's.

Method: `engineering:code-review` at contract level (correctness of shapes, consistency across files, error handling, security of the API surface). Static review only; no Supabase call, no e2e run. File:line references are to the repo.

## 1. The eight low-confidence shapes

The working-folder YAML contains no literal "low confidence / uncertain / unverified / guess" marker (grep over the whole file). What its header does carry is eight claims written from `api.ts` rather than from the handlers: the `x-notes` entries `idempotency`, `naming`, `roles`, `seamError` and the four `shapeDifferences` (register, getContentUrl, setHold, find). Those eight are treated here as the low-confidence shapes. Each is now confirmed or corrected in the YAML with its source line, and a new `x-notes.verification` entry records the audit; no marker had to be kept because the code is unambiguous in all eight cases.

| # | Claim in the YAML | Truth from the code | Changed in the YAML |
|---|---|---|---|
| 1 | idempotency: key format, 24 h, seven ops without stored keys | `api.ts:36-38` generates `<uuid>:document.<op>`; `seam-runtime.ts:84-145` scopes the stored key to tenant+actor+key+operation, replays the stored SeamResult, answers `seam.idempotency.mismatch` (conflict) on a different hash, purges keys older than 24 h on every write, stores only successful results. Key length 8..200 (`schemas/document.ts:22`) but 8..128 for the two config writes (`tenant-config.functions.ts:222, :299`). Ops that store keys: purge, advancePipeline, saveSpecification, resetSpecification. Ops that do NOT: saveView, deleteView, startBulkJob (`search.functions.ts:142, :160, :201`, runRead), createSystem/rotate/revoke/limits (`integration-clients.functions.ts:84-163`, runRead) and also resetTestData (`pipeline.functions.ts:76-119`, bare handler), which the note had missed. | Note rewritten with file:line, resetTestData added to the no-key list, key-length difference recorded; resetTestData description says the header is ignored by the prototype. |
| 2 | naming: listEntities, listActivity, searchDocuments return raw snake_case | Confirmed: `document.functions.ts:41-46` (`id, referred_type, display_name, status_label`), `:145-152` (`id, action, detail, created_at`), `search.functions.ts:26-39` (SearchRow straight from the `search_documents` SQL function, `drizzle/migrations/0009:75-76`). Every other operation in the file already maps to camelCase in its handler. | Note rewritten with file:line; `BusinessEntity.statusLabel` made nullable (`status_label text`, nullable in `drizzle/migrations/0000:69`). |
| 3 | roles: searchPeople has no server check, x-roles says manager+ | Confirmed: `document.functions.ts:158-172` has no role check (same-tenant RLS only). Also found: three exact-role checks the rank table does not express. saveView shared=true and deleteView of a team view accept `role === "tenant_admin"` only (`search.functions.ts:144, :164`; master_admin refused), the five systems ops accept tenant_admin only (`integration-clients.functions.ts:33`), listChildTenants/getChildView/specUsage/resetTestData accept master_admin only. | searchPeople `x-roles` now lists every role (the oracle) with a description recording internal-api.md's manager+ as a UI-only fact; roles note lists the exact-role operations; saveView/deleteView descriptions say master_admin is refused. |
| 4 | seamError: prototype adds `customerFacing.detail`, seam schema lacks it | Confirmed: `document-rules.ts:6-17` (interface) and `:22-34` (`seamError()` always sets `customerFacing {key = code, recoverable = nextAction !== "none", nextAction, detail?}`, `retryable = category === "unavailable"`). | Local `components.schemas.SeamError` defined (seam shape plus `detail`, documented invariants) and a local `responses.Failure`; every operation's `default` and a new `4XX` point at it, with the category to HTTP status mapping in `x-notes.failures`. The purge 409 example no longer lints as invalid. |
| 5 | shapeDifferences.register | Confirmed: `schemas/document.ts:39-50` (contentHash `^sha256:[0-9a-f]{6,64}$`, single relatedEntity {id, role}, mimeType 3..150, size, sensitivity, characteristic <= 50); `document-write.functions.ts:126-195` (edit rank, entity must be in caller's tenant read as the caller -> `entity.notFound`, `doc.type.unknown`, `doc.type.mimeNotAccepted`, `doc.type.tooLarge`, insert draft/uploading + version "1" + relation via service role, audit "upload", reply `{document: raw row, upload: {versionId, method signedUrl, url, token, expiresAt = now + 2 h}}`). | `ui` text replaced by the confirmed check order and shapes. |
| 6 | shapeDifferences.getContentUrl | Confirmed: `document-write.functions.ts:321-355`, `document-rules.ts:146-152`. Order: `doc.notFound` (hidden or no current version), `doc.content.locked` with detail = pipeline state (scanning/quarantined), `doc.version.notFound`, sample kind when storage_path is null or `sample/*` (previewable = pages !== null), else signed URL 300 s / 60 s (download sets the file name), previewable = pdf or image/*, `doc.content.unavailable` on signing failure. | `ui` text replaced by the confirmed order. |
| 7 | shapeDifferences.setHold | Confirmed: `schemas/document.ts:92-101` (reason <= 120 required both ways by refine, reference <= 40), `document-write.functions.ts:386-412` (manage rank, hold columns set/cleared, audit "Hold placed (<ref>): <reason>" / "Hold released: <reason>", reply `{doc, versionsCovered}`). | `ui` text replaced with limits and audit wording. |
| 8 | shapeDifferences.find | Confirmed with two facts the note lacked: `document-write.functions.ts:84-85` runs `expireDue` (service role) before every listing, i.e. listing is what expires documents; `:100-105` the exact characteristic match returns WITHOUT `nextPageToken`. Limits per `schemas/document.ts:29-37`. | `ui` text replaced; `rebuild` says to make the expiry sweep a scheduled job. |

## 2. Per-operation validation (33)

Y = matches the handler after this pass. "Fixed" = changed in the working-folder YAML.

| # | Operation | Handler | Matches? | What differed | Fixed? |
|---|---|---|---|---|---|
| 1 | getMe | `document.functions.ts:11-36` | Y | Never fails with access.none; returns `access: null`. Throws plain Error on store failure (not SeamError). | note in x-notes.failures |
| 2 | listEntities | `:38-47` | Y | statusLabel nullable; raw snake_case; throws `entities.loadFailed`. | Y (type, x-errors, description) |
| 3 | findRecord | `search.functions.ts:96-109` | Y | none (q 2..64, 5 hits, exact id or name prefix, read as caller, no role check) | - |
| 4 | searchPeople | `document.functions.ts:155-172` | Y | No server role check; YAML said manager+. | Y (x-roles all, description) |
| 5 | listSharedWithMe | `:174-222` | Y | none (page 0..1000, 20/page, level is the DB enum view/edit/manage) | - |
| 6 | listActivity | `:141-153` | Y | No page parameter in the prototype (newest 20 only); action values differ from the seam's AccessEvent enum (code writes share, extractionReview, metadataChange, purge). Invisible doc gives [] not doc.notFound. | Y (local ActivityAction enum, description) |
| 7 | retentionFor | `retention.functions.ts:233-249` | Y | none | - |
| 8 | purge | `:177-209`, `document-actions.ts:64-69` | Y | Role check happens after a tenant-only lookup; all refusals carry category conflict (so access.roleTooLow arrives as conflict); detail = purgeState sentence; `"sample:"` prefix test vs `sample/` paths. | Y (description, 409 wording) |
| 9 | advancePipeline | `pipeline.functions.ts:27-73` | Y | none | - |
| 10 | resetTestData | `:76-119` | Y | Not a runWrite handler: Idempotency-Key ignored; YAML required it without saying so. | Y (description, note) |
| 11 | searchDocuments | `search.functions.ts:51-62` | Y | raw snake_case rows (noted) | - |
| 12 | countDocuments | `:66-75`, SQL `0009:119` | Y | Store counts at most 10,001; YAML had no maximum. | Y (maximum 10001, description) |
| 13 | facetDocuments | `:79-93` | Y | none | - |
| 14 | listSavedViews | `:121-134` | Y | none | - |
| 15 | saveView | `:138-154` | Y | "tenant admin" means role tenant_admin exactly; no idempotency. | Y (description) |
| 16 | deleteView | `:156-169` | Y | same exact-role rule | Y (description) |
| 17 | startBulkJob | `:197-229` | Y | ids path intersects with the first 10,001 visible ids (silent drop beyond); ids must be non-empty. | Y (description, minItems 1) |
| 18 | getBulkJob | `:231-240` | Y | none | - |
| 19 | listHolds | `retention.functions.ts:39-71` | Y | none | - |
| 20 | verifyHolds | `:154-174` | Y | hash pattern `^sha256:...` wrong for API-registered documents (bare 64-hex, `tmf-gateway.ts:280, :305-308`). | Y (pattern removed, both forms described) |
| 21 | retentionOverview | `:83-98` | Y | none | - |
| 22 | deletionHistory | `:114-151` | Y | none | - |
| 23 | getConfig | `tenant-config.functions.ts:112-121` | Y | none (manage rank) | - |
| 24 | listChildTenants | `:154-181` | Y | none (master_admin exact) | - |
| 25 | getChildView | `:184-202` | Y | none | - |
| 26 | specUsage | `:205-218` | Y | code is 1..64 here; SpecCode pattern is the saveSpecification one. | note in resetSpecification description |
| 27 | saveSpecification | `:220-297` | Y | Check order (unknownPolicy before role), empty `changes` accepted (YAML had minProperties 1), values validated as string/boolean not enum, `locked` from a country -> access.roleTooLow. | Y (description, minProperties removed) |
| 28 | resetSpecification | `:299-323` | Y | role check is tenant_admin OR master_admin, then group tenant refused; net effect tenant_admin only. | Y (description) |
| 29 | listSystems | `integration-clients.functions.ts:64-72` | Y | none | - |
| 30 | createSystem | `:80-96` | Y | scopes duplicates de-duplicated (YAML had uniqueItems); key is erad_ + exactly 40 base64url chars (YAML said 30+), example keys were 43 chars. | Y |
| 31 | rotateSystemKey | `:100-118` | Y | OAuth tokens minted from the old key stay valid up to 15 min (`tmf-gateway.ts:79-84`); YAML said "stops working at once". | Y (description) |
| 32 | revokeSystem | `:120-137` | Y | re-revoke answers 200 (no revoked_at filter). | Y (description) |
| 33 | updateSystemLimits | `:146-164` | Y | none (bounds 1..6000 / 1..1000, `rate-limit-rules.ts:7`) | - |

Cross-checks done: enums (DocStatus, PipelineState, Sensitivity, Role, Scope, SystemKind, skip reasons, bulk actions/status, crossTenantShare, masterSupervision, InheritMode, access level) all match `schemas/document.ts`, `search-rules.ts`, `tmf667-mapper.ts`, `tenant-rules.ts` and `drizzle/migrations/0000:7-23, :67`. Limits: BR-100 filters match `search-rules.ts:19-31`; page 50 (`PAGE_SIZE`), count cap 10,000 label / 10,001 store, bulk 10,000 / 200 match. x-prototype-only on advancePipeline and resetTestData is correct. Every `api.ts` call has an operation in one of the two YAMLs; `uploadContent` is the only non-API call (documented).

## 3. TMF gateway and mapper findings (`tmf-gateway.ts`, `tmf667-mapper.ts` vs `contracts/seams/tmf667-document.openapi.yaml`, `docs/rebuild/06-api/tmf667.md`, BR-130..142)

Matches: status mapping BR-130 (`tmf667-mapper.ts:26-37`); PATCH targets BR-131 (`:46-49`); scopes BR-132 (`:13, :75-81`, `tmf-gateway.ts:476-492`); SID mapping BR-133 (`:52-57`); paging BR-134 (`:59-60, :135`); invalidQuery and intersection BR-135 (`:98-144`); key/token handling BR-136 (`tmf-gateway.ts:72-106, :692-721`, `readBearer :483-487`); inline 5 MB (413) and URL 25 MB (422) with DNS check BR-137 (`:37-41, :321-351, :380-391`); 404/405 JSON BR-138 (`:656-667`, routes `$.ts`); legacy alias BR-139 (`:670-675`); four-eyes 409 `fourEyesRequired` on both PATCH and /transition BR-140 (`:446-461`, `document-rules.ts:186-188`); category and bundle refs BR-141 (`:157-185`); DocumentBatchEvent BR-142 (`bulk-worker.ts:104-112`, `tmf667-mapper.ts:452-463`); error object `{code, reason, message, status, @type}` (`:62-72`); BR-143 approved-content lock via `metadataPatchAllowed` (`tmf-gateway.ts:499-503`).

Mismatches (contract or doc vs code):

| # | Where | Code says | Contract/doc says |
|---|---|---|---|
| T1 | `tmf-gateway.ts:548-560` DELETE | `deleteState("manager", legal_hold, retain_until, today)`: no group `minRetentionDays` floor | tmf667.md: "same blockers as BR-050"; BR-050 includes the floor. A system can soft-delete what the app refuses. |
| T2 | `tmf-gateway.ts:425` POST /document | No `Location` header on 201 | tmf667.md: "Returns 201 and Location" |
| T3 | `tmf-gateway.ts:563-577` /transition | body `{lifecycleState}` | tmf667.md: body `{to: lifecycleState}` (contract YAML is right) |
| T4 | `tmf-gateway.ts:638` POST /hub | reply field `signingSecret` | tmf667.md: "one-time `secret`" (contract YAML is right) |
| T5 | `tmf667-mapper.ts:268-321` | `retainUntil` is never emitted (selected in DOC_COLS but not mapped) | tmf667.md lists retainUntil as an EradDocument extension; `EradDocument.schema.json` does not |
| T6 | `tmf-gateway.ts:430-441` PATCH | accepts `@type` | contract PATCH schema has `additionalProperties: false` without `@type`: a standard client echoing `@type: EradDocument` passes the code, fails the contract |
| T7 | `tmf-gateway.ts:97-101` | RateLimit-* headers only on 429 | BR-113 reads as "always, Retry-After only on 429"; contract text only promises them on 429 |
| T8 | tmf667.md error list | missing 409 `fourEyesRequired`, `approvedContentLocked`, `legalHold`, `retention`, and 503 on POST | - |
| T9 | `tmf667-mapper.ts:135` | `limit > 100` is clamped silently | contract `maximum: 100` would reject 101 |
| T10 | `tmf-gateway.ts:402-403, :417` | inline/url bytes are stored with `pipeline_state: ready`, bypassing scanning entirely | hard floor `requireMalwareScan` and BR-060 pipeline; in the prototype the scan is simulated, but the rebuild must not copy the shortcut |
| T11 | `tmf-gateway.ts:209` | relation pre-filter `limit(1000)`: records with more than 1000 linked documents lose rows and X-Total-Count is wrong | contract promises exact counts |
| T12 | `tmf-gateway.ts:590` | hold reason 1..500, reference <= 100; `hold_set_by` null so listHolds shows "Set during setup" for system holds | app limits are 120/40 (`schemas/document.ts:97-98`); listHolds label misleading |
| T13 | `tmf667-mapper.ts:408-421` | DocumentBatchEvent `event.document` is an array | tmf667.md envelope shows `event.document` as an object; contract does not specify |
| T14 | `tmf-gateway.ts:671` | `Deprecation: true` | RFC 9745 expects an HTTP date (`@<timestamp>`); the "true" form is the expired draft |
| T15 | `tmf-gateway.ts:79-84` | OAuth tokens reference the system id, so rotating the key does not revoke tokens for up to 15 min | internal YAML rotate summary (fixed) |
| T16 | `tmf-gateway.ts:271, :420` | `relatedEntity[].@referredType` on POST/PATCH is accepted and ignored (entity's stored type wins) | contract marks it required on RelatedEntity |
| T17 | `tmf-gateway.ts:322-337, :339-350` | DNS check and fetch are two separate resolutions (rebinding window) | BR-137 "DNS check that rejects private addresses" is satisfied in letter; the rebuild should pin the resolved IP or resolve inside the fetch |

## 4. Findings

Verdicts: BLOQUEIA = contract would make the rebuild behave differently from the oracle or leak across tenants; CORRIGIR = mismatch fixed in the YAML or needing a spec fix; NOTA = observation.

| # | Verdict | Finding | Where | Contradicts |
|---|---|---|---|---|
| F1 | BLOQUEIA (resolved in YAML) | `ActivityEvent.action` was a $ref to the seam's AccessEvent enum, which lacks `extractionReview`, `metadataChange`, `purge` and uses `accessGranted/accessRevoked/fieldReviewed` the prototype never writes; a rebuild validating replies against it would reject real activity rows or rename events. | `document-write.functions.ts:524, :545, :638`, `retention.functions.ts:206`, `tmf-gateway.ts:530`; seam `document.openapi.yaml:793-805` | BR-095/096, seam AccessEvent |
| F2 | BLOQUEIA (resolved in YAML) | `HeldVersion.hash` pattern `^sha256:` would reject every API-registered version (bare hex) in the verify-hold report, i.e. legal-hold evidence missing in the rebuild. | `tmf-gateway.ts:280, :305-308, :418` vs `schemas/document.ts:27` | BR-137/verifyHolds |
| F3 | CORRIGIR (owner's decision) | TMF DELETE ignores the group `minRetentionDays` floor that the app's delete enforces. | `tmf-gateway.ts:555` vs `document-write.functions.ts:424-437` | BR-050, tmf667.md "same blockers" |
| F4 | CORRIGIR (YAML) | searchPeople `x-roles` said manager+; the oracle has no check. | `document.functions.ts:158-172` | internal-api.md row |
| F5 | CORRIGIR (YAML) | saveView/deleteView/systems ops use exact role `tenant_admin`; `x-roles` rank wording implied master_admin too. | `search.functions.ts:144, :164`; `integration-clients.functions.ts:33` | BR-001 rank model |
| F6 | CORRIGIR (YAML) | resetTestData does not read Idempotency-Key. | `pipeline.functions.ts:76-119` | x-notes.idempotency |
| F7 | CORRIGIR (YAML) | purge: `access.roleTooLow` is returned with category `conflict`; detail carries purgeState sentences. | `retention.functions.ts:191-195` | SeamError category semantics (03-business-rules header) |
| F8 | CORRIGIR (YAML) | `BusinessEntity.statusLabel` nullable; `CreateSystemRequest.scopes` not unique; key pattern length 40; example keys were 43 chars; `countDocuments` maximum 10,001; `BulkJobRequest.ids` minItems 1; `changes` minProperties removed; `changedAfter` accepts a date-time prefix. | see table 2 | - |
| F9 | CORRIGIR (docs, rebuild) | tmf667.md: `{to}` body, `secret`, `Location`, `retainUntil`, incomplete error list (T2-T5, T8). | `docs/rebuild/06-api/tmf667.md:11, :15, :20, :33, :35-42` | code |
| F10 | CORRIGIR (seam, rebuild) | Seam `SeamError.customerFacing` lacks `detail`; seam `IdempotencyKey` is untyped; both now described locally. Owner keeps the kit seam as is (ADR-012), so the rebuild adds `detail` in its own copy. | `document.openapi.yaml:601-610, :565-571` | document-rules.ts:14-16 |
| F11 | CORRIGIR (tmf contract) | PATCH schema lacks `@type` (T6); `limit` maximum vs clamp (T9); RelatedEntity `@referredType` required but ignored (T16). | `tmf667-document.openapi.yaml:131-143, :73, :219` | code |
| F12 | NOTA | `find` expires documents as a side effect of listing (`expireDue` through the service role); the rebuild should schedule it. | `document-write.functions.ts:84-85` | BR-060s (no scheduler) |
| F13 | NOTA | startBulkJob by ids silently drops ids beyond the caller's first 10,001 visible documents. | `search.functions.ts:210-212` | BR-105 |
| F14 | NOTA | API-registered content with inline/url bytes is stored `ready`, bypassing scanning (T10). | `tmf-gateway.ts:402` | BR-060, hard floor requireMalwareScan |
| F15 | NOTA | TMF list pre-filter `limit(1000)` on relations (T11); X-Total-Count can be wrong on large records. | `tmf-gateway.ts:209` | contract exact counts |
| F16 | NOTA | Search facet offers SID entity types (Agreement, BillingAccount, TroubleTicket, Site) that do not exist in the store, and never offers Account/Contract/Line. | `search-rules.ts:17`, `facet-panel.tsx:74`, `drizzle/migrations/0000:67` | 02-domain-model |
| F17 | NOTA | The eleven reads in `document.functions.ts` (getMe, listEntities, get, listVersions, getExtraction, listSpecifications, getTenantPolicy, recordAccess, listActivity, searchPeople, listSharedWithMe) throw plain `Error` (message = code) instead of returning SeamError; the client surfaces them through TanStack's error path, not `SeamFailure`. | `document.functions.ts:45, :61, :74, :86, :95, :102, :108, :132, :151, :170, :194` | 03-business-rules error shape |
| F18 | NOTA | Rate-limit headers only on 429 (T7); Deprecation header format (T14); DNS rebinding window (T17); token survives key rotation (T15); batch event envelope shape (T13); system holds show "Set during setup" (T12). | see table 3 | BR-113, BR-139, BR-137, BR-136 |
| F19 | NOTA | purge filters storage paths with prefix `"sample:"` while sample rows use `"sample/"` (`isSampleStorage`); harmless (store ignores missing objects) but inconsistent. | `retention.functions.ts:197` vs `document-rules.ts:147-149` | - |

No cross-tenant leak found in the internal operations: every write pins the tenant from the role row (`seam-runtime.ts:91-93`), every read runs as the caller, getChildView answers tenant.notFound for both missing and foreign, deletionHistory and purge pin `tenant_id` on the service-role queries, and the TMF gateway pins every query to the key's tenant (`tmf-gateway.ts:189, :213, :458, :525, :557`).

## 5. Redocly lint

`npx --yes @redocly/cli@latest lint contracts/seams/internal.openapi.yaml` from the working folder.

- Before this pass: 0 errors, 42 warnings (operation-4xx-response x30, tag-description x9, info-license x1, no-server-example.com x1, no-invalid-media-type-examples x1 on the purge 409 example's `detail`).
- After this pass: 0 errors, 2 warnings:
  - `info-license` (#/info): no license block; left out on purpose (internal contract).
  - `no-server-example.com` (#/servers/0/url): the Prism mock on localhost; kept because it is the documented mock address.

## 6. Where each item goes

| Fixed in this branch (YAML in the working folder) | Goes to the rebuild | Owner's decision |
|---|---|---|
| Local SeamError with `detail`, local Failure, `4XX` on all 33 ops with category to status mapping | Add `detail` to the seam's SeamError copy used by the rebuild (F10) | Keep searchPeople open to every role (oracle) or restrict to manager+ (F4) |
| ActivityAction enum matching the handlers (F1) | Map snake_case rows (listEntities, listActivity, searchDocuments) to camelCase in the server adapter | TMF DELETE: add the group retention floor to match the app (F3) |
| HeldVersion.hash without the `sha256:` pattern (F2) | Decide one content_hash form and migrate (app `sha256:<hex>` vs API bare hex) | Whether the rebuild honours Idempotency-Key on the eight operations the prototype does not (stricter than the oracle) |
| x-roles and descriptions for exact-role operations (F5) | Schedule the expiry sweep instead of running it inside find (F12) | Whether API-registered content must pass the scan pipeline before `ready` (F14) |
| resetTestData, purge, saveSpecification, resetSpecification, rotate, revoke, startBulkJob, countDocuments, verifyHolds descriptions (F6-F8) | Fix tmf667.md (F9) and the TMF contract (F11) in the repo; add Location on 201 or drop the doc claim (T2) | Facet entity-type list vs stored referred types (F16) |
| statusLabel nullable, scopes de-dup, key pattern/examples, ids minItems, changes minProperties, changedAfter (F8) | Return SeamError instead of thrown Error for the plain reads (F17) | Rate-limit headers on every reply vs 429 only (T7) |
| Tag descriptions, x-notes.verification and x-notes.failures | Pin resolved IP for URL fetches and callbacks (T17); RFC 9745 Deprecation date (T14) | Whether rotating a key should revoke its outstanding OAuth tokens (T15) |
