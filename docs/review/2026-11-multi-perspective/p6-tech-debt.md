# P6 — Technical debt: what must NOT be ported, and what the rebuild would inherit

Repository: `/Users/earatat/telco-docs-compass`, branch `review/multi-perspective-2026-11` (HEAD `ec27a8c`).
Perspective: technical debt (identify → categorise → prioritise by **risk × blast radius**; no time, cost or ROI figures, per the owner's rule).
Method: static reading of every file in scope, `diff` of `docs/rebuild/reference/` against `src/`, `bun run test` (14 files passed, 2 skipped, 185 tests passed, 1 expected fail, 17 skipped), `npx tsc --noEmit` (clean), `npx eslint` on three single files. No hosted backend was called, no `e2e/*.py` run, no Prettier run, no file edited.

Verdict key
- **BLOQUEIA** — debt that, if ported, breaks an invariant in `docs/rebuild/17-kiro-steering/invariants.md` or makes the oracle lie (including `reference/` copies that drifted from `src/`).
- **CORRIGIR** — debt the rebuild must consciously not copy.
- **NOTA** — cleanliness; no behavioural consequence.

---

## 0. Summary of verdicts

| # | Verdict | Finding | Blast radius |
|---|---|---|---|
| B1 | BLOQUEIA | `reference/rules/document-rules.ts` and `document-actions.ts` (and their rule-tests) drifted from `src`: BR-143 approved-content protection is missing | Every port made "1:1 from reference/" (09, tech.md) ships without BR-143; `e2e/tmf-api.py` section 4 fails on the target |
| B2 | BLOQUEIA | `reference/postgres-schema/` lacks migration `0015_documents_registered_by_client.sql` | BR-140 (API four-eyes) has no column in the reference schema that 04 points at |
| B3 | BLOQUEIA | Four-eyes is enforced in two of three transition paths; bulk approve (`bulk-worker.ts` + `bulkSkipReason`) never checks the creator | Invariant 5 has a hole in the oracle; a port copying three paths inherits it |
| B4 | BLOQUEIA | `expireDue` ignores `legal_hold` and runs as a side effect of a read | Contradicts the handbook glossary ("Legal hold blocks deletion **and expiry**"); mutates data on `find`; audit rows with `actor = null` |
| B5 | BLOQUEIA | `reference/rule-tests/` lacks `invariant-gates.test.ts` (added on this branch) and two integration tests differ from `src` | The "tests ported 1:1" set is incomplete; gates for invariants 5–8, 10, 11 never reach Kiro |
| C1 | CORRIGIR | Simulated pipeline (`advancePipeline`, `simulatedOutcome`, `use-upload.walk`) and BR-062 carrying `TEST-QUARANTINE` markers as a business rule | Whole pipeline module |
| C2 | CORRIGIR | `resetTestData` server function and admin card listed as product features (06, 13) | Admin module, data destruction path |
| C3 | CORRIGIR | Sample pages (`isSampleStorage`, `kind: "sample"`, `sample_pages`) plus prefix mismatch `sample/` vs `sample:` | Content module, purge path |
| C4 | CORRIGIR | Cron over HTTP with `LOVABLE_CRON_SECRET`; "3 rounds per call"; first bulk batch run inline in the request | Events and search modules |
| C5 | CORRIGIR | Supabase auth stack (`requireSupabaseAuth`, `auth-attacher`, `previewAuthStorage`, `/auth` screen, `claims.email`) | Identity module, every server function |
| C6 | CORRIGIR | `/design` route, Lovable error reporting, global `console.error` monkey-patch, `localStorage` theme | Frontend shell |
| C7 | CORRIGIR | Three divergent copies of transition / hold / idempotency / delete logic across `document-write`, `tmf-gateway`, `bulk-worker` | Document, integration, search modules |
| C8 | CORRIGIR | Two idempotency runtimes with different stored shapes, TTL handling and key validation; Cassandra DDL in 10 drops `actor` and `operation` from the key | Shared module; replay semantics |
| C9 | CORRIGIR | Writes executed under `runRead` (no idempotency, no audit, no visibility check): key create/rotate/revoke/limits, saved views, bulk start | Invariant 9 (audit written by the operation) is silently not met for key lifecycle |
| C10 | CORRIGIR | Supabase row shapes (snake_case, embedded relations, raw `find`/`get` rows) consumed by 10 UI files; client builds the storage path from `tenant_id` | Angular port would copy `.document_type` and bucket layout |
| C11 | CORRIGIR | Postgres-only semantics that carry business rules in SQL: outbox trigger decides event types; `effective_specifications` inheritance; `_doc_search_where`; `block_mutation`; `SKIP LOCKED`; `api_hit` | Must be re-specified as rules + tests; none has a TS rule or test today |
| C12 | CORRIGIR | Two error contracts: `document.functions.ts` throws `Error("code")`, everything else returns `SeamResult`; `use-me` bypasses `api.ts` | ADR-09 |
| C13 | CORRIGIR | `tmf-events` imports `resolvesPublic` from `tmf-gateway` (events → integration HTTP handler file); DNS check calls `cloudflare-dns.com` | Module boundary in 09; external dependency inside a security check |
| C14 | CORRIGIR | Legacy `documentManagement/v4` alias: nine duplicate route files, `legacy()`, duplicated spec fields, legacy event names | Owner's decision whether the target serves it |
| C15 | CORRIGIR | Two search paths coexist (`find` in the write module with `ilike`; `searchDocuments` via SQL functions) | Records page vs Documents page would get two engines in the target |
| C16 | CORRIGIR | Dead code and dead dependencies (45 of 46 `components/ui` files, 9 npm packages with zero imports, 19 Radix packages used only by dead files, Drizzle with a blank schema) | Build size, supply chain, false signals to a porter |
| C17 | CORRIGIR | Modules with no tests but spec-relevant behaviour (seam-runtime, tmf-gateway, tmf-events, bulk-worker, retention, search, tenant-config, integration-clients, pipeline, document(.write)) | Parity can only be claimed through e2e |
| C18 | CORRIGIR | `e2e/*.py` hand-rolled `check()` with module-level `sys.exit`; `tmf-api.py` defaults to the **legacy** path; helpers need the service role | Parity suite shape |
| N1 | NOTA | ESLint runs Prettier as a rule, so `bun run lint` fails on every file (138 errors in `tmf-gateway.ts` alone); `no-unused-vars` off | Hygiene |
| N2 | NOTA | Hold/retention copy that describes prototype limits ("content store is not locked in this prototype"), "Prototype · synthetic data only" badge in 10 places; 13 lists the badge as an AppShell feature | Copy inventory |
| N3 | NOTA | Scattered constants (bucket name ×3, upload ticket 2 h ×2, page sizes 20/50/50, 90/30-day windows), `as unknown as` casts (16 in services) | Cleanliness |
| N4 | NOTA | Ad-hoc `console.info(JSON.stringify(...))` logging in two shapes; seam logs have no `requestId` | 14-non-functional §37 |

---

## 1. The three large modules

### 1.1 `src/services/tmf-gateway.ts` (721 lines)

Responsibilities mixed in one file (line ranges):

| Lines | Responsibility | Kind |
|---|---|---|
| 37–41 | Size limits (`MAX_BODY_CHARS`, `MAX_INLINE_BYTES`, `MAX_URL_FETCH_BYTES`) | config |
| 54–63 | HTTP reply/erro envelope (`reply`, `errorReply`) | I/O (HTTP) |
| 65–66 | `DOC_COLS` column list | persistence detail |
| 72–106 | `authenticate`: bearer parsing, token lookup, key lookup, expiry, scope, rate limit, `last_used_at` write, log line | auth + rate limit + I/O + logging (5 concerns) |
| 108–116 | `readJson` body size and parse | HTTP |
| 118–126 | `audit` (second audit writer; the first is `seam-runtime.audit`) | I/O |
| 129–155 | `idempotent` (second idempotency runtime; the first is `seam-runtime.runWrite`) | rule + I/O |
| 157–185 | `loadTmfDocs`: four queries, then pure mapping via `toTmfDocument` | I/O + mapping |
| 187–193 | `findDoc`, `notFound` | I/O |
| 197–267 | Reads: list, get (+ audit `view`), attachment content (signed URL, pipeline lock), specifications | I/O + rule (BR-060) |
| 271–298 | Zod schemas for create | validation |
| 300–351 | `sizeBytes`, `sha256Bytes`, `decodeBase64`, `resolvesPublic` (DNS-over-HTTPS to cloudflare-dns.com), `fetchBytes` | pure helpers + **outbound network** |
| 353–427 | `createDocument`: entity check, spec check, mime/size, inline/url bytes, hash check, insert document, upload bytes, insert version, update current, insert relations, signed upload URL, audit, reload | orchestration (11 writes, no transaction) |
| 430–443 | PATCH schema, media types | validation |
| 446–461 | `applyTransition`: status path, system four-eyes, pending details, update, audit | **rule + I/O (duplicate of document-write 364–381)** |
| 463–541 | `patchDocument`: content-type, body peek for scope, auth, schema, `metadataPatchAllowed`, entity check, merge characteristic, update, upsert relations, audit, transition | orchestration |
| 543–545 | `asCharacteristicRows` | pure (duplicate of mapper `asCharacteristics`) |
| 548–561 | `deleteDocument`: `deleteState("manager", …)` hard-codes a role | rule + I/O |
| 563–588 | `transitionDocument` | orchestration |
| 590–613 | `setLegalHold`: sets `hold_set_by: null` | rule + I/O (duplicate of document-write 387–412) |
| 617–648 | Hub subscribe/unsubscribe: secret generation, DNS check | I/O |
| 652–675 | 405/404/legacy headers | HTTP |
| 679–721 | OAuth client-credentials token endpoint | auth + I/O |

What is pure and already extracted: everything in `tmf667-mapper.ts` (status mapping, query parsing, field selection, document/spec/event mapping, bearer parsing, IP/callback checks, HMAC/sha) and in `rate-limit-rules.ts`, `document-rules.ts` (`isTransitionAllowed`, `metadataPatchAllowed`, `pendingRequiredDetails`, `systemMayApprove`, `idempotencyOutcome`, `hashBody`), `document-actions.ts` (`deleteState`).

What the Java modular monolith (09) needs to split: `authenticate` → `integration` (key/token lookup) + `shared` (rate limit decision) + `identity` (CallerContext for systems); `idempotent`/`audit` → `shared` (one implementation, see C8); `applyTransition` → `document` application service (one implementation shared with the UI path and bulk, see B3/C7); `createDocument` → `document` + `pipeline` (bytes intake) + object store port; `resolvesPublic`/`fetchBytes` → `shared` outbound-URL policy (no DoH); hub → `events`; OAuth → `identity`. Controllers keep only lines 54–63, 108–116, 652–675.

Deltas vs. the UI path that could diverge (and already do):

| Concern | `document-write.functions.ts` | `tmf-gateway.ts` | `bulk-worker.ts` / `search-rules.ts` |
|---|---|---|---|
| Transition path | 364–367 `transitionCapability` + `isTransitionAllowed` | 447 `isTransitionAllowed` (scope checked earlier at 479/575) | `bulkSkipReason` 137–141 |
| Four-eyes | 370 `isOwnDocument(created_by, userId)` | 449 `systemMayApprove(registered_by_client, clientId)` | **absent** (`created_by` not even selected, 25–30) |
| Required details gate | 371–378 | 452–456 | 35–44, 142 |
| Hold | 395–405 sets `hold_reference`, `hold_set_by = userId` | 604–608 sets `hold_reference`, **`hold_set_by = null`** | 72–75 **no `hold_reference`**, `hold_set_by = created_by` |
| Delete blockers | 424–437 `deleteBlocker` incl. group `minRetentionDays` floor | 554–556 `deleteState("manager", …)` **no group floor** | n/a |
| Idempotency | `runWrite` (seam-runtime 97–139) | `idempotent` (129–155) | none (job id) |
| Audit writer | `seam-runtime.audit` (actor = user, `version_id`) | `tmf-gateway.audit` (actor = null, "· via {name}") | inline insert 84–90 |
| Content lock on download | `contentLocked(pipeline_state)` 329 | inline `scanning || quarantined` 244 | n/a |

Consequence for `listHolds` (`retention.functions.ts:63`): a hold placed by a connected system shows "Set during setup" because `hold_set_by` is null — the oracle lies about who placed the hold.

### 1.2 `src/services/document-write.functions.ts` (646 lines)

| Lines | Responsibility | Kind |
|---|---|---|
| 40–53 | `BUCKET`, `DOC_COLUMNS`, result types | config/persistence |
| 55–76 | `adminClient` (lazy import), `today`, `fail`, `loadDoc`, `specFor` | glue |
| 79–123 | `find` — a **read** living in the write module; calls `expireDue` (85) as a side effect; `ilike` search with partial escaping (106); exact `contains` on `characteristic` (102); page token = offset | I/O + legacy search + hidden mutation |
| 126–195 | `register`: role, entity, spec, mime/size, insert doc, insert version, update current, insert relation, signed upload URL (2 h hard-coded, 190), audit | orchestration (6 writes, no transaction) |
| 198–233 | `updateMetadata`: computes changed fields, `metadataPatchAllowed`, `keepUnread` pipeline override (223–227) | rule + I/O; mixes pipeline state into metadata |
| 236–319 | `addVersion`: frozen/protected checks, count-based label, restore-from-version copy, new version + upload ticket (2 h hard-coded again, 314) | orchestration |
| 322–355 | `getContentUrl`: content lock, **sample branch (336–339)**, signed URL 300/60 s | rule + I/O + prototype |
| 358–384 | `transition` (see table above) | rule + I/O |
| 387–412 | `setHold` + `versionsCovered` count | rule + I/O |
| 415–442 | `deleteDocument` with group floor lookup (424–428) | rule + I/O |
| 445–469 | `restoreDeleted`: manual visibility (deleted rows invisible to RLS) | access rule reimplemented in TS |
| 472–489 | `reportProblem` incl. send-back status change | rule + I/O |
| 492–548 | `grantAccess`/`revokeAccess` (user vs tenant branches) | rule + I/O |
| 551–599 | `listAccess`: 5 queries, joins in memory, loads **all profiles** of the tenant (562) | read in write module; N-size fetch |
| 602–646 | `reviewExtraction`: field update, characteristic merge, audit by field name | rule + I/O |

Pure and already extracted: `document-rules.ts` (all status/role/protection/delete/idempotency rules), `document-actions.ts`, `review-flow-rules.isOwnDocument`. What must move for 09: `find`/`listAccess`/`getContentUrl` → read side of `document`/`access`; `expireDue` → `retention` scheduled job; `keepUnread` → `pipeline`; `restoreDeleted` visibility → `DocumentAccessService.canSee` (ADR-04) instead of a second hand-written access check; the two "2 h" literals and `BUCKET` → `shared` config.

### 1.3 `src/services/tmf667-mapper.ts` (506 lines)

Entirely pure (no I/O) and tested (`tmf667-mapper.test.ts`, `tmf667-audit-gaps.test.ts`, `invariant-gates.test.ts` for BR-130/131). Identical to `reference/rules/tmf667-mapper.ts`. Port as-is, with two notes:

- It mixes four rule families that 09 puts in different modules: TMF resource mapping (`integration`), event envelope/matching (`events`, 366–463), security primitives (`readBearer`, `isPrivateIp`, `isSafeCallback`, `sha256Hex`, `hmacHex`, 472–506 → `shared`), and the legacy-alias policy (`LEGACY_SUNSET`, `LEGACY_ONLY`, `acceptedMimeTypes`/`maxSizeMb` duplicated at 360–362). Split by module when porting; keep the tests together.
- Exports with **no direct test** in `tmf667-mapper.test.ts`: `fromStandardReferredType`, `tmfError`, `asExternalIdentifiers`, `v4EventType`, `sha256Hex`, `hmacHex` (`categoryFromDefinition` is covered in `tmf667-audit-gaps.test.ts`). `hmacHex` is the signing primitive of invariant 10; `e2e/tmf-events.py` verifies it end-to-end only.
- `DocRow`, `VersionRow`, `RelationRow`, `SpecRow` are snake_case Supabase shapes used as the mapper input contract. The Java `IntegrationRules` should take domain DTOs, not row types, or the row names leak into the integration module.

---

## 2. Findings in detail

### B1 — `reference/rules` and `reference/rule-tests` drifted from `src` (BLOQUEIA)

`diff src/services/document-rules.ts docs/rebuild/reference/rules/document-rules.ts` — the reference copy lacks lines 82–97 of `src`: `APPROVED_STATUSES`, `contentProtected`, `ALWAYS_EDITABLE_FIELDS`, `PatchCheck`, `metadataPatchAllowed`.
`diff src/services/document-actions.ts …/reference/rules/document-actions.ts` — lacks `APPROVED_CONTENT_REASON` and `contentEditState` (src 44–53) and the `contentProtected` import.
`diff` of rule-tests: `document-rules.test.ts` lacks the "approved content protection" suite (src 103–131, 7 tests); `document-actions.test.ts` lacks "approved content actions" (src 80–95, 3 tests).

Why it blocks: `09-target-architecture.md` ("ported 1:1 from `reference/rules/*.ts`, with the tests ported 1:1 from `reference/rule-tests/`"), `17-kiro-steering/tech.md` lines 18–19, and `03-business-rules.md` BR-143 (line 164) which cites exactly the missing suite by name. A Kiro port would implement `document-write.updateMetadata` (215–216), `addVersion` (246), `reviewExtraction` (612) and TMF PATCH `409 approvedContentLocked` (tmf-gateway 499–503) against a rule that does not exist in its source of truth. Git: `contentProtected` entered `src` in `6df62c0` (2026-11-10); the reference copies were last written the same day (`d23c01a`, `71894ca`) from the earlier state.

The other eight rule files and seven rule-tests are byte-identical (`event-delivery-rules`, `rate-limit-rules`, `review-flow-rules`, `review-rules`, `search-rules`, `tenant-rules`, `tmf667-mapper`, `upload-rules`).

### B2 — `reference/postgres-schema` lacks `0015` (BLOQUEIA)

`diff -rq docs/rebuild/reference/postgres-schema drizzle/migrations`: 15 files identical, `0015_documents_registered_by_client.sql` only in `drizzle/migrations`. That migration adds `documents.registered_by_client`, the column BR-140 / `systemMayApprove` (document-rules 186–188) and `tmf-gateway.ts:407,449` depend on. `04-security-and-tenancy.md:4` names `reference/postgres-schema/` as the policy source; `10-data-mapping-cassandra.md` DDL (line 37–38 region) does not list `registered_by_client` either.

### B3 — Four-eyes missing on the bulk path (BLOQUEIA)

`search-rules.ts:124–144 bulkSkipReason` checks role, unchanged, allowed path and pending details for `transition`, but never the creator. `bulk-worker.ts:25–30` selects `id, status, legal_hold, sensitivity, document_type, current_version_id` — not `created_by` — and `JobRow.created_by` (the actor) is never compared. A contributor-turned-reviewer who added a document can approve it by selecting it in the Documents page and running "Approve" as a bulk change. Invariant 5 and BR-022 ("enforced on the server") are not met on that path, and `invariant-gates.test.ts` gates only `isOwnDocument`/`footerAction`, not the bulk rule. If the rebuild ports `bulkSkipReason` 1:1 (it is in `reference/rules`), it inherits the hole. Fix in the oracle is small (add `createdBy`/`actorId` to `BulkDocFacts`) but it changes a reference rule file, so it is the owner's call where it lands.

### B4 — `expireDue` ignores holds and mutates on read (BLOQUEIA / owner's decision)

`retention.functions.ts:212–224`: `UPDATE documents SET status='expired' WHERE tenant_id=? AND expiry_date < today AND status IN (approved, effective) AND deleted_at IS NULL`, then one audit row per document with no actor. Called from `document-write.find` (85) with the admin client, every time any user lists documents.
- `00-README.md` glossary: "Legal hold — Blocks deletion **and expiry** regardless of retention". The code expires held documents; expired is frozen (BR-013), so a held effective document becomes uneditable through a read.
- `docs/decisions/2026-11-10-expiry-without-scheduler.md` records only the "no cron" part; it does not decide the hold question.
- `08-search-at-scale.md`/`11` list expiring documents via OpenSearch — the target has no `find` to piggy-back on, so this side effect disappears unless re-specified as a job (`retention` module, 09). The hold rule must be decided by the owner before that job is written.

### B5 — `invariant-gates.test.ts` and the integration tests are not in `reference/rule-tests` (BLOQUEIA)

`src/services/__tests__/invariant-gates.test.ts` (388 lines, commit `ec27a8c` on this branch) gates invariants 5, 6, 7, 8, 10, 11 and BR-130/131 with exact copy strings. It is absent from `reference/rule-tests/`. The reference copies of `access.integration.test.ts` and `share-isolation.integration.test.ts` also differ from `src` (the `DEMO_PASSWORD` guard, `c68fdb6`). With `tech.md:19` ("values that match `reference/rule-tests/`"), the gates would not be ported.

### C1 — Simulated pipeline

Do not port: `pipeline.functions.ts:26–73 advancePipeline` (downloads the file, decodes latin1, decides by markers), `upload-rules.ts:103–121 simulatedOutcome`/`nextPipelineState` (markers `TEST-QUARANTINE`, `TEST-UNREADABLE`, `.exe`), `use-upload.ts:24,48–61` (700 ms steps, 6 iterations, client drives the server state machine), `updateMetadata.keepUnread` (document-write 223–227), `api.advancePipeline`. `16-traceability.csv` BR-062 and `03` carry the markers as a tested business rule, and `06-api/internal-api.md:36` lists `advancePipeline` as an API operation. Replacement (09 pipeline module "simulated → real later"): the state machine `uploading → scanning → (quarantined | reading) → (failed | ready)` and the content-lock rule (BR-060) are the rule to keep; the transitions are driven by scan/extraction workers, and the client only reads state. BR-062's marker clause should be re-worded as a test-double contract, not a rule.

### C2 — `resetTestData`

`pipeline.functions.ts:75–119` (tenant-id prefix check `aurora-`, seed-id prefix check `00000000-0000-0000-0000-`, storage removal, tombstoning, idempotency wipe), `components/admin/reset-test-data.tsx`, `api.resetTestData`. Listed as a feature in `06-api/internal-api.md:37` and `13-angular-frontend.md:39` ("reset test data" among admin components). Replacement: Testcontainers reseed from `docs/rebuild/fixtures/synthetic-seed.sql`; no product endpoint. If the owner wants a usability-session reset in production, it needs its own spec (it is a bulk purge).

### C3 — Sample pages and the `sample/` vs `sample:` mismatch

`document-rules.ts:146–149 isSampleStorage` (null or `sample/`), `document-write.getContentUrl:336–339` returns `kind:"sample"` with `sample_pages` JSON, `review/document-page.tsx:79` ("can't be shown in the prototype"), seed uses `sample/<type>` (`0000:194`, `fixtures/synthetic-seed.sql:125+`). `retention.functions.ts:197 purgeDocument` filters `sample:` (colon) — so purge sends `sample/...` paths to storage removal (a no-op today, a wrong call in the target). `pipeline.functions.ts:98` uses `sample/`. Replacement: object store with real fixture files; `ContentResult` becomes signed-URL only; one `isSampleStorage` if fixtures keep placeholder rows.

### C4 — Scheduler over HTTP

`src/integrations/supabase/cron-auth.ts` (generated, `LOVABLE_CRON_SECRET`/`_PREVIOUS`), `routes/api/public/tmf-events/deliver.ts`, `routes/api/public/jobs/bulk-documents.ts:14–15` ("3 rounds per call keeps large jobs moving without hitting the request time limit"), `search.functions.ts:223–225` (first bulk batch runs inside the request so "small jobs finish without waiting for the scheduler"), `e2e/deliver-once.ts`/`events-helper.ts deliver` (the test suite triggers delivery by running the worker with the service role). Replacement: in-process scheduled workers in `events` and `search` (09 request-flow diagram); no public cron route, no shared secret, no "rounds per call" tuning, bulk jobs fully asynchronous (the UI already polls `getBulkJob`).

### C5 — Supabase auth and Lovable preview plumbing

`integrations/supabase/auth-middleware.ts` (generated; throws plain `Error("Unauthorized…")`, not `SeamError`), `auth-attacher.ts`, `previewAuthStorage.ts` (Lovable editor broker), `client.ts`/`client.server.ts` (Proxy singletons on `process.env`), `routes/auth.tsx` (password form), `document.functions.getMe` reading `claims.email`, `start.ts:30–35`. Replacement: `12-keycloak.md` (realm, clients, claims) + `keycloak-angular`; `identity` module builds `CallerContext` from the JWT and confirms the app role (ADR-07). `getMe` becomes a claims + `user_roles` read with no e-mail fallback for `displayName` (`document.functions.ts:33`).

### C6 — Frontend prototype constructs

- `/design` route (`routes/design.tsx`, 204 lines) and decision `01-foundation-gaps.md` last row ("Scoped `[data-theme]` token copies — lets /design show light and dark side by side") → Storybook per `05-screens/design.md:8`.
- `lib/lovable-error-reporting.ts`, `routes/__root.tsx:16,44` (`window.__lovableEvents`), `lib/error-capture.ts` imported first in `server.ts:1` and **replacing `console.error` globally** (55–63), `lib/error-page.ts` inline HTML with hex colours (contrary to the project's own token rule). Replacement: Angular `ErrorHandler`, Spring problem details; never patch the console.
- `hooks/use-theme.ts:11,22` `localStorage` key `erad-theme`, default light then flip after mount (SSR flash). `13-angular-frontend.md:22` keeps a theme toggle; where the preference lives (browser vs profile) is the owner's decision; do not copy the two-render flip.
- `hooks/use-mobile.tsx` is used only by dead `components/ui/sidebar.tsx`.

### C7 — Three divergent copies of the same command logic

See the table in §1.1. The rebuild must have one `DocumentService.transition/hold/delete` used by the UI controller, the TMF controller and the bulk worker, with the actor abstracted (person vs system) so that four-eyes is `createdBy == actor || registeredByClient == actor`. Also unify the delete rule: the UI path applies the group `minRetentionDays` floor (document-write 424–436), the API path does not (tmf-gateway 554–556 uses `deleteState("manager", …)` with a hard-coded role).

### C8 — Idempotency: two runtimes, one pure rule, and a DDL that changes the key

Pure and good: `document-rules.ts:155–180` (`stableStringify`, `hashBody`, `idempotencyOutcome`, `IDEMPOTENCY_TTL_HOURS`). Debt:
- `seam-runtime.runWrite:97–98` deletes expired rows on **every** write (table-wide `DELETE … WHERE created_at < cutoff` with the admin client); `tmf-gateway.idempotent` never purges.
- Stored shape differs: `SeamResult` (seam-runtime 136) vs `{status, body}` (tmf-gateway 152); success criterion `res.ok` vs `status < 300 || 204`.
- Key validation only on the API side (`/^[A-Za-z0-9_-]{8,128}$/`, 131); the UI schema accepts any 8–200 chars (`pipeline.functions:20`, `tenant-config:223`).
- Check-then-insert (select → run → insert) is not atomic; ADR-03 (`INSERT … IF NOT EXISTS`) fixes the race but requires the stored response to be written in a second step — specify what a concurrent second caller sees between the two writes.
- Postgres PK is `(tenant_id, actor, key, operation)` (`0000:346–347`); the Cassandra DDL in `10-data-mapping-cassandra.md:83–84` is `PRIMARY KEY ((tenant_id, key))`, dropping `actor` and `operation`. With the oracle's key scheme (`api.ts:36` `${uuid}:document.${op}`) collisions are unlikely, but TMF clients choose their own keys, so two systems in one tenant using the same `Idempotency-Key` would replay each other's responses. Owner's decision on the key shape; the oracle's is the safer one.
- `api.ts:42–49` generates a fresh key per call and no hook passes `idempotencyKey` on retry, so UI-side replay is never exercised in the prototype; the Angular port must own retry keys explicitly (13 "State and data").

### C9 — Writes under `runRead`

`integration-clients.functions.ts`: `createSystem` (80–96), `rotateSystemKey` (100–118), `revokeSystem` (120–137, also deletes subscriptions), `updateSystemLimits` (146–164) — all run inside `runRead`, use the admin client, write no `document_events` row and take no idempotency key. Invariant 9 ("Audit is written by the operation itself") is not met for the whole key lifecycle; `activityLabel` has no label for it either. `search.functions.ts`: `saveView` (138–154), `deleteView` (156–169), `startBulkJob` (197–229) likewise. The rebuild should route every command through the command pipeline (idempotency + audit) and add `systemCreated/systemRotated/systemRevoked/limitsChanged` audit actions; whether those are shown in the UI is the owner's decision.

### C10 — Supabase row shapes in the UI and client-built storage paths

37 references to snake_case columns in 10 UI files: `components/access/why-can-i-see.tsx`, `access/manage-access-dialog.tsx`, `search/start-lists.tsx`, `search/results-table.tsx`, `documents/document-panel.tsx`, `documents/document-actions-bar.tsx`, `documents/document-details.tsx`, `routes/_authenticated/records.$entityId.tsx`, `records.$entityId_.review.$docId.tsx`, `hooks/use-upload.ts`. Sources: `document-write.find` returns raw rows with embedded `extraction_fields(...)`/`document_relations(...)` (88), `document.functions.get` returns the full row (58), `SearchRow` (search.functions 26–39) is snake_case by design, `use-review.ts:11,28` casts rows `as unknown as ReviewField[]` and reads `version_id`. `use-upload.ts:88` builds the object path `${doc.tenant_id}/${reg.upload.versionId}` on the client — bucket layout is part of the client contract. Eight components import types from `*.functions.ts` directly (not through `api.ts`). `AGENTS.md` already warns against `select("*")` (no occurrence found). Rebuild: camelCase DTOs from `docs/rebuild/contracts/`, upload ticket carries the full URL and nothing else, `api.ts`-equivalent is the only import surface.

### C11 — Postgres semantics with no Cassandra equivalent that carry rules in SQL

| Construct | Where | What must be re-specified (and tested) in the target |
|---|---|---|
| 22 RLS policies, `enable row level security` on every table | `0000`, `0004`, `0006`, `0007`, `0009` | ADR-04 `DocumentAccessService.canSee` + ArchUnit; truth table from `can_see_document` (`0000:250+`) and the recursion fixes (`0002`, `0006`) that encode "parent/child tenant" visibility |
| SECURITY DEFINER helpers: `user_tenant`, `my_parent_tenant`, `is_my_child_tenant`, `entity_in_my_tenant`, `has_role`, `can_see_document`, `effective_specifications` (two overloads: caller-scoped and `p_tenant`), `master_document_stats`, `_doc_search_where`, `search_documents`, `count_documents`, `facet_documents`, `search_document_ids`, `api_hit`, `claim_event_deliveries`, `documents_to_outbox` | migrations | **`effective_specifications`** holds the group→country inheritance/override merge that `tenant-rules.ts` only partly covers (locks, floors); the merge itself has no TS rule and no test. `master_document_stats` enforces invariant 2 (counts only) in SQL. |
| `documents_outbox` trigger (`0007:48–68`) | SQL | The rule "which column changes produce which event type" (create / delete / status / `legal_hold`,`current_version_id`,`characteristic` → attribute change; anything else → **no event**, e.g. a rename emits nothing) lives only in SQL. ADR-02 writes the outbox row in the command, so this decision table must become an `EventRules` class with tests (BR-127 lists the names but not the trigger conditions). |
| `block_mutation` triggers on `document_versions`/`document_events` (`0000:242–247`), `user_roles_guard` | SQL | Invariant 9 append-only: enforce by repository design + ArchUnit (no update/delete methods), and by a test. |
| `FOR UPDATE SKIP LOCKED` in `claim_event_deliveries` (`0014:26–35`) | SQL | ADR-03 LWT `IF locked_until < now`; BR-125 "overlapping passes never send twice" must be re-tested with two concurrent workers (Testcontainers). |
| `api_hit` upsert counter with 10-minute self-purge (`0012:27–37`) | SQL | ADR-11 counter table; counters cannot TTL (10 says so) — purge job needed. |
| Generated `tsvector` column (`0009:4`), `ilike`, JSON containment `cs` (tmf-gateway 217), `contains("characteristic", …)` (document-write 102), PostgREST `.or("id.eq.…")` string filters built by interpolation (`pipeline.functions:86`, `search.functions:105`, `document.functions:191`) | TS | OpenSearch queries (11); none of these filter strings should be ported textually. |
| `count: "exact"` on every list (`find`, `listHolds`, `listDocuments` 213) | TS | Cassandra has no cheap exact count; 08 already caps `count_documents` — decide per screen (`X-Total-Count` in TMF list, `total` in `find`). |
| Service-role vs caller client split (`caller` for reads, `admin` for writes) | every `*.functions.ts` | Disappears with ADR-04; make sure the "read as the caller" guarantees (e.g. `listHolds` 38 "only documents they can see appear") are re-asserted as `canSee` filters. |

### C12 — Two error contracts

`document.functions.ts` throws `Error("entities.loadFailed")` (45), `Error("documents.loadFailed")` (61), `Error("access.none")` (102, 127), `Error("access.denied")` (132) etc.; `api.ts:55–65` passes these through without `unwrap`, so screens get a generic `Error` whose `message` is the code. `AGENTS.md` states every seam op returns `SeamResult`; ADR-09 says the same for the target. `hooks/use-me.ts:2` imports `getMe` from the functions module, bypassing `api.ts`. Port one contract.

### C13 — Module boundary and external dependency in a security check

`tmf-events.ts:11` imports `resolvesPublic` from `tmf-gateway.ts` (the HTTP handler file), so the `events` module depends on `integration`'s controller-level file; in 09 the dependency should go through `shared`. `resolvesPublic` (`tmf-gateway 322–337`) resolves callback hosts via `https://cloudflare-dns.com/dns-query` with a 3 s timeout and fails closed; `isSafeCallback` additionally rejects any host containing `:` (IPv6 literals) and `.local`. Target: JVM resolver (or the platform's egress policy) with the same private-range table (`isPrivateIp`, tested), no third-party DoH endpoint, decision recorded (it changes the failure mode when DNS is slow: today every subscription becomes "callback resolves to a private address" after 3 s).

### C14 — Legacy `documentManagement/v4` alias

Nine route files under `routes/api/public/tmf-api/documentManagement/v4/` wrap the same handlers in `legacy()` (Deprecation/Sunset/Link headers, `LEGACY_SUNSET` 2027-05-10 in mapper 9); `toTmfSpecification` keeps `acceptedMimeTypes`/`maxSizeMb` as top-level fields "until the legacy address is retired" (360–362); `LEGACY_ONLY` event names (374, 380–385); `e2e/tmf-api.py:27` **defaults `TMF_API` to the legacy base path**. Owner's decision whether the target ships the alias at all; if not, the parity suite must be pointed at `STD` and the legacy branches of the mapper and its tests dropped together.

### C15 — Two search engines

`document-write.find` (records page; `ilike` on name after stripping `%_,()`, exact `contains` on `characteristic`, offset paging, exact count) and `search.functions.searchDocuments` (documents page; SQL functions with the `canSee` rule inlined, keyset cursor). `08-search-at-scale.md` describes only the second. If the Angular records page is ported from `records.$entityId.tsx` it will ask for the first. Rebuild: one search port (OpenSearch) with a record filter.

### C16 — Dead code and dead dependencies (verified by import graph)

| Item | Evidence | Note |
|---|---|---|
| `src/components/ui/*` — 45 of 46 files | only `ui/dropdown-menu.tsx` is imported outside `ui/` (`documents/document-menu.tsx:3`); `ui/` files import each other (8) and `@/lib/utils` | `erad/app-shell.tsx` uses `@radix-ui/react-dropdown-menu` directly, so even that one can go |
| `hooks/use-mobile.tsx` | imported only by dead `ui/sidebar.tsx` | dead |
| npm: `recharts`, `cmdk`, `vaul`, `embla-carousel-react`, `react-day-picker`, `input-otp`, `react-resizable-panels`, `react-hook-form` | 1 import each, all inside `components/ui/` | dead |
| npm: `@hookform/resolvers` | 0 imports | dead |
| npm: 19 `@radix-ui/*` packages (`accordion`, `alert-dialog`, `aspect-ratio`, `avatar`, `collapsible`, `context-menu`, `hover-card`, `label`, `menubar`, `navigation-menu`, `popover`, `progress`, `scroll-area`, `separator`, `slider`, `slot`, `switch`, `toggle`, `toggle-group`) | used only by `components/ui/` | dead once `ui/` goes; 7 Radix packages are live via `erad/` (`checkbox`, `dialog`, `dropdown-menu`, `radio-group`, `select`, `tabs`, `tooltip`) |
| devDeps `drizzle-orm`, `drizzle-kit`, `postgres` | 0 imports; `drizzle/schema.ts` is one comment line ("auto-generated and intentionally left blank"); `drizzle.config.ts` points at `LOVABLE_DB_MIGRATION_URL` | Drizzle is a shell: migrations are hand-written SQL (`0007`/`0008` named `_migration`), `0003` and `0015` are one-liners; `meta/` snapshots are machine state |
| devDeps `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` | setup only (`src/test/setup.ts`); no component test exists | the vitest `environment: "jsdom"` costs every rule test a DOM for nothing |
| `class-variance-authority` | 1 live use (`erad/button.tsx`?) — 9 of 10 uses in `ui/` | keep or inline |
| `tw-animate-css` | only `@import` in `styles.css:3` | verify utility usage before removing |
| Code: `fromStandardReferredType`, `tmfError`, `asExternalIdentifiers`, `v4EventType`, `sha256Hex`, `hmacHex` | exported, used, but no direct unit test | not dead; untested |
| `src/routes/README.md` | Lovable/TanStack routing boilerplate | not part of the product |

Live and clean: `src/lib/utils.ts` (`cn`, used by `erad/*`), `lib/document-labels.ts` (tested, 17 importers), all other hooks.

### C17 — Modules without tests and the spec-relevant behaviour inside them

| Module (no test file) | Spec-relevant behaviour that is only covered by e2e or nothing |
|---|---|
| `seam-runtime.ts` | idempotency replay/conflict wiring, 24 h purge-on-write, `can_see_document` gate before privileged writes, `accessDenied` audit on refusal (invariant 9), error-to-`seam.unavailable` mapping, log fields |
| `tmf-gateway.ts` | everything in §1.1: auth order (401 → 403 → 429), `last_used_at`/`last_rate_limited_at`, body limits, inline/url intake, hash mismatch 422, PATCH scope selection by body peek (476–479), merge-patch semantics for `characteristic`/`relatedEntity` (510–528), four-eyes for systems, hold with null setter, OAuth token issue + purge of expired tokens (715) — covered only by `e2e/tmf-api.py` (97 checks) and `tmf-rate-isolation.py` |
| `tmf-events.ts` | fan-out same-tenant filter + `subscribedBefore`, defence-in-depth tenant check (80), DNS re-check per delivery, signing headers, outcome bookkeeping — covered only by `e2e/tmf-events.py` (43 checks) |
| `bulk-worker.ts` | per-document re-check (B3), hold without reference, audit action mapping (88), batch event per pass (BR-142), job status transitions, failure → `failed` |
| `retention.functions.ts` | `expireDue` (B4), purge sequence and tombstone (BR-053), `purgeState` wiring incl. the `sample:` filter (C3), deletion history 30 days/200 rows, "Set during setup" fallback |
| `search.functions.ts` | filter normalisation to RPC, cursor validation, saved-view ownership (`tenant_admin` only for shared), bulk id resolution "as the person" (203–213), `BULK_LIMIT+1` cap |
| `tenant-config.functions.ts` | `fromGroup` computation (244, operator precedence `!!current && … \|\| …`), override insert id `spec-${tenant}-${code}` truncated to 80, audit per changed key, reset-to-group rule |
| `integration-clients.functions.ts` | key format `erad_` + 30 random bytes base64url, prefix = first 10 chars, 365-day expiry, revoke cascades subscriptions, unaudited (C9) |
| `pipeline.functions.ts` | prototype-only (C1, C2) |
| `document.functions.ts`, `document-write.functions.ts` | all orchestration in §1.2; `listSharedWithMe` record-id rule (BR-093) is covered only by the `RUN_ACCESS_TESTS=1` suites and `e2e/share-isolation.py` |
| `api.ts` | `SeamFailure` mapping, key generation |
| `src/lib/error-capture.ts`, `error-page.ts`, `lovable-error-reporting.ts` | prototype-only (C6) |

`15-test-strategy.md` already plans parity ports of the four Python suites (169+ checks) and JUnit for rules; the rows above are what those parity checks must cover because no unit test will.

### C18 — `e2e/*.py` shape

Four scripts, each with its own `def check(ok, msg)` (share-isolation 27, tmf-api 40, tmf-events 33, tmf-rate-isolation 26), module-level `sys.exit` when `DEMO_PASSWORD` is unset (fixed on this branch to read the env var; previously a literal), `requests` + Playwright mixed, `SKIP_SLOW`, and helpers (`events-helper.ts`, `deliver-once.ts`) that run `deliverPending`/`recordBatchEvent` **in-process with the service role** — i.e. the parity suite depends on test hooks that bypass the API. `tmf-api.py:27` defaults to the legacy base path (C14). For the target: keep the assertions (they are the oracle for 169+ behaviours), replace the runner (pytest or Playwright test), and define equivalent test hooks (a test-profile scheduler trigger, a key-minting fixture) instead of a service-role import.

### N1 — Lint/format state

`eslint.config.js` extends `eslint-plugin-prettier/recommended`, `.prettierrc` sets `printWidth: 100`, the code is written at 200+ columns: `npx eslint src/services/tmf-gateway.ts` → 138 errors (all Prettier), `document-rules.ts` 8, `tmf667-mapper.ts` 44. `bun run lint` therefore fails on every file and is evidently never run; `@typescript-eslint/no-unused-vars` is off and `noUnusedLocals` false. `tsc --noEmit` is clean. Not a porting matter; it does mean "lint passes" cannot be used as a signal when deciding what the oracle guarantees.

### N2 — Prototype copy and prototype decisions in the pack

"Prototype · synthetic data only" (`erad/app-shell.tsx:61`, `routes/auth.tsx:64` and meta 16–18), "This prototype has no public links" (`manage-access-dialog.tsx:52`), "Scan is simulated in this prototype" (`upload-progress.tsx:86`), "This page can't be shown in the prototype" (`document-page.tsx:79`), "The content store is not locked in this prototype" (`holds-tab.tsx:96`, `use-document-actions.ts:41`). `13-angular-frontend.md:22` lists the "prototype badge" as part of AppShell; `docs/decisions/2026-11-10-hold-metadata-only.md` is a prototype limitation presented as a decision — in the target with S3-compatible storage (09) object lock is available, so this is the owner's decision, not a port.

### N3 — Scattered constants and casts

`BUCKET = "documents"` in `document-write` 40, `pipeline.functions` 10, and inline in `retention` 198 / `tmf-gateway` 247, 417, 421; upload ticket `2 * 3600_000` in `document-write` 190 and 314 (not a rule, not returned by storage); `PAGE = 20` (retention), `PAGE_SIZE` (search-rules) and `pageSize ?? 50` (find 86); 90-day expiring window (retention 91) and 30-day/200-row deletion history (120, 128) are UI rules living in I/O code; `MAX_*` and `TOKEN_TTL_SECONDS`, `KEY_LIFETIME_DAYS` in three files. 16 `as unknown as` casts in services (7 in `tmf-gateway`) around `Json` typing. Also `asCharacteristicRows` (tmf-gateway 543) duplicates `asCharacteristics` (mapper 261).

### N4 — Logging

`seam-runtime.logOp` (37) and `tmf-gateway` (104, 413) log different JSON shapes; seam logs carry no `requestId` although `14-non-functional.md:37` requires one per API call; `pipeline.functions:111` logs raw DB error messages. Target: one structured logger in `shared` with `requestId`, tenant, op, outcome, duration — and nothing else (invariant 9 applies to logs too).

---

## 3. Do not port (one line each: construct — file:line — replacement in target)

- Simulated pipeline stepper — `src/services/pipeline.functions.ts:26–73`, `src/hooks/use-upload.ts:24,48–61` — real scan/extraction workers behind the `pipeline` module (09); client reads state only.
- Simulation markers `.exe` / `TEST-QUARANTINE` / `TEST-UNREADABLE` — `src/services/upload-rules.ts:103–107`; BR-062 clause in `03`/`16` — test doubles in the worker test profile, not a business rule.
- `keepUnread` pipeline override inside metadata update — `src/services/document-write.functions.ts:214,223–227,230` — a `pipeline` command (`markReadAsIs`) with its own audit.
- `resetTestData` + admin card — `src/services/pipeline.functions.ts:75–119`, `src/components/admin/reset-test-data.tsx`, `src/services/api.ts:107`, `06-api/internal-api.md:37`, `13:39` — Testcontainers reseed from `fixtures/synthetic-seed.sql`.
- Sample-page content branch — `src/services/document-write.functions.ts:49–51,336–339`, `src/services/document-rules.ts:146–149`, `document_versions.sample_pages` — object-store fixtures; `ContentResult` is signed-URL only.
- `sample:` purge filter (inconsistent with `sample/`) — `src/services/retention.functions.ts:197` — none (goes away with the row above).
- Expiry as a side effect of listing — `src/services/retention.functions.ts:212–224`, `src/services/document-write.functions.ts:84–85`, `docs/decisions/2026-11-10-expiry-without-scheduler.md` — scheduled job in `retention`; hold-vs-expiry rule decided first (B4).
- HTTP cron routes and secret — `src/integrations/supabase/cron-auth.ts`, `src/routes/api/public/tmf-events/deliver.ts`, `src/routes/api/public/jobs/bulk-documents.ts:14–15` — in-process schedulers (`events`, `search`).
- Inline first bulk batch in the request — `src/services/search.functions.ts:223–225` — fully asynchronous job; UI polls.
- Supabase auth middleware, attacher, preview storage, clients — `src/integrations/supabase/auth-middleware.ts`, `auth-attacher.ts`, `previewAuthStorage.ts`, `client.ts`, `client.server.ts`, `src/start.ts:30–35` — Keycloak (12) + `identity` module.
- Password sign-in screen — `src/routes/auth.tsx` — Keycloak login redirect (`13` routing table).
- `claims.email` as display-name fallback — `src/services/document.functions.ts:20,28,33` — profile display name only.
- `/design` route and scoped `[data-theme]` token copies — `src/routes/design.tsx`, `docs/decisions/01-foundation-gaps.md` last row — Storybook (`05-screens/design.md`).
- Lovable error reporting — `src/lib/lovable-error-reporting.ts`, `src/routes/__root.tsx:16,44` — Angular `ErrorHandler`.
- Global `console.error` patch and h3 500 normaliser — `src/lib/error-capture.ts:55–63`, `src/server.ts:1,21–45`, `src/lib/error-page.ts` — Spring problem details; no console patching; error page from tokens.
- `localStorage` theme with post-mount flip — `src/hooks/use-theme.ts:11,22` — theme service (preference location = owner's decision; no two-render flip).
- Theme/prototype badge and prototype copy — `src/components/erad/app-shell.tsx:61`, `src/routes/auth.tsx:16–18,64`, `manage-access-dialog.tsx:52`, `upload-progress.tsx:86`, `document-page.tsx:79`, `holds-tab.tsx:96`, `use-document-actions.ts:41`, `13:22` — remove; hold copy depends on object-lock decision.
- `components/ui/*` (45 dead shadcn files) and `hooks/use-mobile.tsx` — `src/components/ui/`, `src/hooks/use-mobile.tsx` — not ported (ERAD primitives in `src/components/erad/` are the port source, `13`).
- Dead packages — `package.json`: `recharts`, `cmdk`, `vaul`, `embla-carousel-react`, `react-day-picker`, `input-otp`, `react-resizable-panels`, `react-hook-form`, `@hookform/resolvers`, 19 `@radix-ui/*`, `drizzle-orm`, `drizzle-kit`, `postgres` — none.
- Drizzle shell — `drizzle/schema.ts` (blank), `drizzle.config.ts`, `drizzle/migrations/meta/` — Cassandra DDL (10); the SQL files remain the oracle for policies and functions.
- Legacy alias — `src/routes/api/public/tmf-api/documentManagement/v4/*` (9 files), `tmf-gateway.ts:670–675`, mapper `8–9,360–362,374,380–385`, `e2e/tmf-api.py:27` default — owner's decision; if dropped, drop the mapper branches and tests together.
- Second idempotency runtime — `src/services/tmf-gateway.ts:129–155` — one `shared` idempotency service (ADR-03), replay header kept for TMF.
- Table-wide idempotency purge on every write — `src/services/seam-runtime.ts:97–98` — TTL on the table (10).
- Second and third audit writers — `src/services/tmf-gateway.ts:118–126`, `src/services/bulk-worker.ts:84–90` — one `shared` audit writer with actor = person or system.
- Second transition/hold/delete implementations — `src/services/tmf-gateway.ts:446–461,548–561,590–613`, `src/services/bulk-worker.ts:70–83` + `search-rules.ts:124–144` — one `document` application service used by UI, TMF and bulk (with four-eyes for all three).
- Hard-coded `deleteState("manager", …)` on the API path — `src/services/tmf-gateway.ts:555` — same `deleteBlocker` (with group floor) as the UI.
- `hold_set_by: null` for system holds — `src/services/tmf-gateway.ts:606` — actor model that records the system; `listHolds` "Set during setup" fallback (`retention.functions.ts:63`) goes.
- Writes under `runRead` — `src/services/integration-clients.functions.ts:80–164`, `src/services/search.functions.ts:138–229` — command pipeline with audit.
- Throwing reads — `src/services/document.functions.ts:45,61,74,87,94,102,108,127,132,151,170,194` — `SeamResult` (ADR-09).
- Direct server-function import in a hook — `src/hooks/use-me.ts:2` — through the API client.
- Snake_case rows and embedded relations in the UI — `document-write.functions.ts:52–53,88`, `document.functions.ts:58`, `search.functions.ts:26–39`, the 10 UI files in C10 — camelCase DTOs from `contracts/`.
- Client-composed storage path — `src/hooks/use-upload.ts:88` — opaque upload URL from the server.
- `find` legacy search — `src/services/document-write.functions.ts:79–123` — `search` module (08/11) with a record filter.
- Loading every profile of the tenant to name three lists — `src/services/document-write.functions.ts:562` — join by id set.
- DNS-over-HTTPS to a third party inside the callback check — `src/services/tmf-gateway.ts:321–337`, reused by `tmf-events.ts:11,90` — platform resolver + `isPrivateIp` table in `shared`.
- `events` → `integration` import — `src/services/tmf-events.ts:11` — `shared` URL policy.
- PostgREST filter strings built by interpolation — `src/services/pipeline.functions.ts:86`, `search.functions.ts:105`, `document.functions.ts:191`, `tmf-gateway.ts:217`, `document-write.functions.ts:102,107` — typed queries (OpenSearch/CQL).
- Outbox event-type decision in a trigger — `drizzle/migrations/0007_migration.sql:48–68` — `EventRules` class + test in `events`; command writes the outbox row (ADR-02).
- Append-only by trigger — `drizzle/migrations/0000:242–247` — repository design + ArchUnit + test.
- `SKIP LOCKED` claim — `drizzle/migrations/0014:26–35` — LWT claim (ADR-03) + concurrency test for BR-125.
- `api_hit` upsert counter — `drizzle/migrations/0012:27–37` — counter table + purge job (ADR-11).
- `effective_specifications` merge in SQL — `0000`/`0008` — `TenantRules.effectiveSpecifications` + tests (today untested).
- `count: "exact"` on lists — `document-write 91`, `retention 48`, `tmf-gateway 213` — capped counts (08) or none, per screen.

## 4. Port as-is (pure, tested, identical in `reference/`)

- `src/services/rate-limit-rules.ts` (+ `rate-limit-rules.test.ts`, gates for invariant 11) — identical.
- `src/services/event-delivery-rules.ts` (+ test, gates for invariant 10) — identical; note `verifyEventSignature` is async/WebCrypto, port with a constant-time compare.
- `src/services/review-flow-rules.ts` (+ test) — identical.
- `src/services/review-rules.ts` (+ test) — identical.
- `src/services/search-rules.ts` (+ test) — identical, **but** `bulkSkipReason` must gain the creator check (B3) before it is the oracle.
- `src/services/tenant-rules.ts` (+ test) — identical.
- `src/services/upload-rules.ts` (+ test) — identical, minus `simulatedOutcome` (C1); keep `nextPipelineState`, batch-state rules.
- `src/services/tmf667-mapper.ts` (+ `tmf667-mapper.test.ts`, `tmf667-audit-gaps.test.ts`) — identical; split by module as in §1.3; add tests for the six untested exports.
- `src/services/document-rules.ts` and `document-actions.ts` (+ tests) — port from **`src`**, not from `reference/` (B1).
- `src/lib/document-labels.ts` (+ test) — copy source for the Angular copy table (invariant 12 "exact English").
- `src/services/__tests__/invariant-gates.test.ts` — port as the gate suite (B5).
- `src/services/document-rules.ts:155–180` idempotency primitives (`stableStringify`, `hashBody`, `idempotencyOutcome`) — the only idempotency code to keep.

## 5. Drift between `src/services` and `docs/rebuild/reference` (diff run on this branch)

| File | State |
|---|---|
| `reference/rules/document-rules.ts` | DRIFT — missing `src` 82–97 (BR-143) |
| `reference/rules/document-actions.ts` | DRIFT — missing `src` 44–53 and the `contentProtected` import |
| `reference/rules/{event-delivery,rate-limit,review-flow,review,search,tenant,upload}-rules.ts`, `tmf667-mapper.ts` | identical |
| `reference/rule-tests/document-rules.test.ts` | DRIFT — missing "approved content protection" (7 tests) |
| `reference/rule-tests/document-actions.test.ts` | DRIFT — missing "approved content actions" (3 tests) |
| `reference/rule-tests/access.integration.test.ts`, `share-isolation.integration.test.ts` | DRIFT — `DEMO_PASSWORD` guard differs (this branch, `c68fdb6`); benign |
| `reference/rule-tests/` | MISSING `invariant-gates.test.ts` (this branch, `ec27a8c`) |
| `reference/rule-tests/` other 7 tests | identical |
| `reference/postgres-schema/` | MISSING `0015_documents_registered_by_client.sql`; 15 files identical |
| `docs/rebuild/03-business-rules.md` BR-143 | cites the missing suite by name |

## 6. Fixed in this branch / goes to the rebuild / owner's decision

| Item | Fixed in this branch | Goes to the rebuild | Owner's decision |
|---|---|---|---|
| B1 reference rule/test drift (BR-143) | no — needs a copy refresh of 4 files (not done here; no edits allowed) | port from `src` until refreshed | who owns `reference/` sync (a script or a check that diffs on CI) |
| B2 `0015` missing in reference schema | no | copy `0015` | — |
| B3 bulk approve without four-eyes | no (reference rule file) | one transition service with creator/registering-system check | whether to patch `bulkSkipReason` in the oracle first (it changes a reference rule) |
| B4 `expireDue` ignores holds, mutates on read | no | scheduled job in `retention` | hold-vs-expiry rule (glossary vs code) |
| B5 gates/integration tests not in reference | partly (tests exist on this branch) | port `invariant-gates.test.ts` | add to `reference/rule-tests` |
| C1 simulated pipeline / BR-062 markers | no | real workers; BR-062 reworded | wording of BR-062 |
| C2 `resetTestData` | no | removed; fixture reseed | whether a production "reset" feature is wanted |
| C3 sample pages, `sample:`/`sample/` | no | removed | — |
| C4 cron over HTTP | no | in-process schedulers | — |
| C5 Supabase auth | no | Keycloak (12) | — |
| C6 `/design`, Lovable reporting, console patch, theme storage | no | Storybook, ErrorHandler | where the theme preference lives |
| C7 three copies of command logic | no | one application service per command | — |
| C8 idempotency key shape | no | ADR-03 | Cassandra PK `(tenant, key)` vs oracle `(tenant, actor, key, operation)` |
| C9 unaudited key lifecycle and views/bulk start | no | command pipeline + new audit actions | whether key events appear in a UI log |
| C10 snake_case DTOs, client storage path | no | camelCase DTOs, opaque upload URL | — |
| C11 SQL-resident rules (outbox trigger, spec merge, canSee, append-only, SKIP LOCKED, counters) | no | `*Rules` classes + tests, ADR-02/03/04/11 | — |
| C12 two error contracts | no | ADR-09 | — |
| C13 DoH dependency, events→gateway import | no | platform resolver, `shared` policy | failure mode when DNS is slow |
| C14 legacy alias | no | — | keep or drop the alias and its sunset date |
| C15 two search paths | no | one search port | — |
| C16 dead UI files and packages | no | not ported | pruning `main` (not required for the port) |
| C17 untested I/O modules | no | parity suites (15) must cover the listed behaviours | — |
| C18 e2e runner shape, legacy default | `DEMO_PASSWORD` literal removed (`c68fdb6`), README section added (`8cd46ff`) | assertions kept, runner replaced, test hooks re-specified | pytest vs Playwright test |
| N1 lint never passes | no | n/a (Angular lint) | run Prettier once on `main` or drop the plugin |
| N2 prototype copy and decisions | no | strip | object lock for holds in the target |
| N3 scattered constants | no | `shared` config | — |
| N4 log shapes | no | one logger with `requestId` | — |

Static analysis only; nothing in the repository was modified.
