# P3 — Business rules and tests (review/multi-perspective-2026-11)

Repo: /Users/earatat/telco-docs-compass, branch review/multi-perspective-2026-11. Nothing committed by this pass.
Method: engineering:testing-strategy (pyramid: unit for pure rules, integration for server/SQL, parity e2e for TMF). For each of the 105 BR ids in docs/rebuild/03-business-rules.md the named source module and test file were read; status is ASSERTED / PARTIAL / ABSENT / SERVER-ONLY as defined in the brief. A clause is only "asserted" when a unit test fixes the behaviour, including the exact English string when the spec quotes one.

Note: a parallel pass added and committed `src/services/__tests__/invariant-gates.test.ts` (commit ec27a8c, 37 cases, one `it.fails`) while this audit ran. It is listed in `current_test` where it asserts a rule, but the audit below is independent of it.

## Counts

| status | before | after |
|---|---|---|
| ASSERTED | 20 | 66 |
| PARTIAL | 62 | 26 |
| ABSENT | 10 | 0 |
| SERVER-ONLY | 13 | 13 |

`it(` cases per file (before → after; `it.each` counted once):

| file | before | after | added |
|---|---|---|---|
| document-rules.test.ts | 16 | 32 | +16 |
| document-actions.test.ts | 19 | 27 | +8 |
| review-rules.test.ts | 9 | 21 | +12 |
| review-flow-rules.test.ts | 14 | 25 | +11 |
| upload-rules.test.ts | 12 | 19 | +7 |
| search-rules.test.ts | 12 | 22 | +10 |
| tenant-rules.test.ts | 10 | 18 | +8 |
| rate-limit-rules.test.ts | 7 | 11 | +4 |
| event-delivery-rules.test.ts | 8 | 12 | +4 |
| tmf667-mapper.test.ts | 28 | 37 | +9 |
| tmf667-audit-gaps.test.ts | 9 | 9 | 0 |
| access.integration.test.ts | 8 | 8 | 0 (runIf RUN_ACCESS_TESTS) |
| share-isolation.integration.test.ts | 2 | 2 | 0 (runIf RUN_ACCESS_TESTS) |
| invariant-gates.test.ts (other pass) | — | 33 | — |

Runs (offline, no RUN_ACCESS_TESTS, no e2e):
- before: `bun run test` → Test Files 13 passed | 2 skipped (15); Tests 149 passed | 17 skipped (166)
- after: `bun run test` → Test Files 14 passed | 2 skipped (16); Tests 274 passed | 1 expected fail | 17 skipped (292). The "expected fail" is the other pass's `it.fails` (BR-122). `npx tsc --noEmit` → exit 0, no output.
- `eslint` is not a gate: the repo's prettier rule already fails on pre-existing lines of every test file (224 problems in the ten files, most pre-existing); no Prettier was run.

## Audit table

Legend for "test": file:`it` name. Before = status of the branch as found; After = after this pass.

| BR | before | after | test | note |
|---|---|---|---|---|
| BR-001 | PARTIAL | ASSERTED | document-rules.test.ts:`BR-001 role rank: viewer < contributor < reviewer < manager < tenant_admin = master_admin` | ROLE_RANK is not exported; asserted as the capability table per role (tenant_admin and master_admin identical). |
| BR-002 | PARTIAL | ASSERTED | document-rules.test.ts:`BR-002 edit needs contributor, review needs reviewer, manage needs manager` | Previously only 5 of the 6 boundary pairs. |
| BR-003 | SERVER-ONLY | SERVER-ONLY | — | SQL trigger user_roles_guard (drizzle/migrations/0000). No unit or integration test. |
| BR-004 | PARTIAL | PARTIAL | document-actions.test.ts:`BR-004 a manage share caps a manager at contributor, a viewer stays viewer` | "manage" share level was untested. "Reviewing, approving and managing access need record access" is server-side (document-write.functions.ts). |
| BR-010 | PARTIAL | PARTIAL | document-rules.test.ts:`BR-010 allowed transitions table is exactly the spec's` | superseded→archived and archived→nothing were untested. Code doc.transition.notAllowed is server (document-write.functions.ts:367). |
| BR-011 | PARTIAL | PARTIAL | document-actions.test.ts:`BR-011 send back needs review: reviewer may, contributor may not, and only while in review` | Server reportProblem (document-write.functions.ts:482) untested. |
| BR-012 | PARTIAL | ASSERTED | document-rules.test.ts:`BR-012 capability per target: in_review edit, approved review, every other target manage` | Only approved/effective were covered. |
| BR-013 | PARTIAL | PARTIAL | document-rules.test.ts:`BR-013 frozen statuses are superseded, expired and archived` | expired/archived were untested. doc.edit.frozen is server. |
| BR-014 | ABSENT | ASSERTED | document-actions.test.ts:`BR-014 labels: Send for approval, Approve, Make effective, Mark as superseded, Archive` | No test asserted any label. |
| BR-015 | PARTIAL | ASSERTED | document-actions.test.ts:`BR-015 role reasons: edit, review, manage` | Confirmed: reason was only toBeTruthy. All three strings match the spec. |
| BR-016 | PARTIAL | ASSERTED | document-actions.test.ts:`BR-016 frozen edit reason` | Text matches spec. |
| BR-017 | PARTIAL | PARTIAL | document-actions.test.ts (existing approvedSummary cases) | Pure part asserted. UI label differs from spec: approved-summary.tsx:40 "and N more in the list below" vs spec "+N more". |
| BR-020 | PARTIAL | PARTIAL | document-rules.test.ts:`should block approve while a required detail is pending`; review-rules.test.ts:`BR-021 gate reason: singular and plural` | Error code doc.approve.requiredPending with detail=count is server (document-write.functions.ts:378). |
| BR-021 | PARTIAL | ASSERTED | review-rules.test.ts:`BR-021 gate reason: singular and plural` | Singular string was never produced by approveGate in a test. |
| BR-022 | PARTIAL | PARTIAL | review-flow-rules.test.ts:`BR-022 four-eyes reason text` | Text now literal (was via constant). Server doc.approve.ownDocument untested. |
| BR-023 | ABSENT | PARTIAL | review-rules.test.ts:`BR-023 a pending detail stays pending whatever its confidence` | Pure gate ignores confidence. The storing step (pipeline) is server. |
| BR-024 | PARTIAL | ASSERTED | review-flow-rules.test.ts:`BR-024 journey step for a draft, and no journey for closed statuses` | draft and superseded/expired were untested. |
| BR-025 | PARTIAL | ASSERTED | review-flow-rules.test.ts:`BR-025 footer action order: role, then gate, then four-eyes`; `BR-025 Next detail only for people who can review; …` | Order of refusals and "Back to document" for approved were untested. |
| BR-026 | PARTIAL | ASSERTED | review-flow-rules.test.ts:`BR-026 outcome text omits zero parts and reads 'All details checked.' with none` | "not in the document" and the no-parts form were untested. |
| BR-030 | ABSENT | PARTIAL | review-rules.test.ts:`BR-030 field status words` | "Not checked yet" now asserted. Confirm/Correct/"Not in this document" are UI (field-row.tsx:122-125). |
| BR-031 | ABSENT | ASSERTED | review-rules.test.ts:`BR-031 confidence band labels` | |
| BR-032 | PARTIAL | ASSERTED | review-rules.test.ts:`BR-032 unknown confidence comes first and ties sort by name` | |
| BR-033 | PARTIAL | ASSERTED | review-flow-rules.test.ts:`BR-033 page order breaks ties by name and treats a missing source as page 1, top` | |
| BR-034 | PARTIAL | ASSERTED | review-flow-rules.test.ts:`BR-034 most urgent: contract-critical, then flagged, then lowest band, then list position` | flagged branch was untested. |
| BR-035 | ASSERTED | ASSERTED | review-rules.test.ts:`should jump to the next unchecked field and wrap round` | |
| BR-036 | PARTIAL | ASSERTED | review-flow-rules.test.ts:`BR-036 applies only to quote, order and contract numbers; normalises; ignores values under 4 characters` | |
| BR-037 | PARTIAL | ASSERTED | review-flow-rules.test.ts:`BR-037 VAT hints` | Three hints now literal; match spec. |
| BR-038 | PARTIAL | ASSERTED | review-flow-rules.test.ts:`BR-038 Date and Until fields must read as a date` | Confirmed: hint text was not asserted. |
| BR-039 | PARTIAL | ASSERTED | review-flow-rules.test.ts:`BR-039 reason priority and exact texts` | Spec does not quote the "differs"/"matches" texts; source: "Differs from the record. Compare with the page." / "Matches the record." |
| BR-040 | SERVER-ONLY | SERVER-ONLY | — | document-write.functions.ts:627-636 (reviewExtraction). |
| BR-041 | ASSERTED | ASSERTED | review-rules.test.ts:`BR-041 edited note names the band and the original, and is absent otherwise` | Null branches added. |
| BR-042 | PARTIAL | ASSERTED | review-rules.test.ts:`BR-042 banner: singular and plural` | |
| BR-043 | ASSERTED | ASSERTED | review-rules.test.ts:`BR-043 unknown codes become sentence case and the raw code is never shown` | |
| BR-050 | PARTIAL | ASSERTED | document-rules.test.ts:`BR-050 …` (4 cases) | Order and the two retention details (date, floor date 2031-11-04) were untested. |
| BR-051 | PARTIAL | ASSERTED | document-actions.test.ts:`BR-051 soft delete needs manage and names the hold or the keep-until date` | Both strings match spec. |
| BR-052 | PARTIAL | ASSERTED | document-actions.test.ts:`BR-052 permanent deletion: administrators only, blocked by a hold, blocked while retain_until >= today` | "Only administrators…", hold text and the >= edge were untested. |
| BR-053 | SERVER-ONLY | SERVER-ONLY | — | Confirmed untested. retention.functions.ts:197-206. |
| BR-054 | SERVER-ONLY | SERVER-ONLY | — | document-write.functions.ts:438,465. |
| BR-055 | PARTIAL | ASSERTED | tenant-rules.test.ts:`BR-055 max(policy days, group minimum) with a raised flag only when the floor applies` | not-raised branch was untested. |
| BR-056 | PARTIAL | PARTIAL | search-rules.test.ts:`should skip holds when the role is below manager` | Only the manage requirement is unit-visible; recording reason/reference/set-by is server (document-write.functions.ts:395-403). |
| BR-060 | PARTIAL | PARTIAL | document-rules.test.ts:`should lock content while scanning or quarantined` | doc.content.locked / 409 contentLocked are server. |
| BR-061 | ABSENT | PARTIAL | document-rules.test.ts:`BR-061 preview URL lives 300 s and download URL lives 60 s` | Constants asserted; the signed-URL call is server. |
| BR-062 | ASSERTED | ASSERTED | upload-rules.test.ts:`should quarantine .exe files and TEST-QUARANTINE content`; `should walk uploading to ready…` | |
| BR-063 | PARTIAL | ASSERTED | upload-rules.test.ts:`BR-063 default type reasons…`; `BR-063 every contract word counts…` | Three of four reasons were untested. |
| BR-064 | PARTIAL | ASSERTED | upload-rules.test.ts:`BR-064 wrong file type message` | |
| BR-065 | PARTIAL | ASSERTED | upload-rules.test.ts:`BR-065 too large message` | Confirmed: text was not asserted. |
| BR-066 | PARTIAL | ASSERTED | upload-rules.test.ts:`BR-066 duplicate name message uses the existing document's name and only warns` | |
| BR-067 | ASSERTED | ASSERTED | upload-rules.test.ts:`should never show 100 % while files are still being checked` | |
| BR-068 | PARTIAL | ASSERTED | upload-rules.test.ts:`BR-068 size: B, then KB rounded, then MB with one decimal`; `BR-068 names up to 40 characters…` | formatSize had no test. |
| BR-069 | ASSERTED | ASSERTED | upload-rules.test.ts:`should shorten entity ids for the drop overlay` | |
| BR-070 | PARTIAL | ASSERTED | document-rules.test.ts:`BR-070 stable JSON form sorts keys and drops undefined, hash is SHA-256 hex` | |
| BR-071 | PARTIAL | PARTIAL | document-rules.test.ts:`BR-071 same hash replays the stored response` | seam.idempotency.mismatch is server (seam-runtime.ts:112). |
| BR-072 | ABSENT | PARTIAL | document-rules.test.ts:`BR-072 idempotency keys expire after 24 h` | Cutoff query is server (seam-runtime.ts:97). |
| BR-080 | ASSERTED | ASSERTED | tenant-rules.test.ts:`BR-080 only tenant_admin or master_admin may change configuration` | Added all four lower roles. |
| BR-081 | PARTIAL | ASSERTED | tenant-rules.test.ts:`BR-081 a locked type, or a locked/inherit area, is refused with the group named` | Confirmed: both refusal texts were untested; the inherit/locked area branch had no test at all. |
| BR-082 | ASSERTED | ASSERTED | tenant-rules.test.ts:`BR-082 extend mode allows containsPersonalData and requiresReview…` | Source detail text (not in spec): "<group> lets this organisation add to its types, not replace their settings." |
| BR-083 | ASSERTED | ASSERTED | tenant-rules.test.ts:`BR-083 years = round(days/365), singular for one year…` | |
| BR-084 | PARTIAL | ASSERTED | tenant-rules.test.ts:`BR-084 own settings read 'Added here'` | |
| BR-085 | PARTIAL | ASSERTED | tenant-rules.test.ts:`BR-085 relation sentences for extend, override and the default` | |
| BR-086 | PARTIAL | ASSERTED | tenant-rules.test.ts:`BR-086 impact text in the plural and for a single tenant` | |
| BR-087 | SERVER-ONLY | SERVER-ONLY | — | effective_specifications (SQL) + tenant-config.functions.ts. |
| BR-090 | SERVER-ONLY | SERVER-ONLY | access.integration.test.ts; share-isolation.integration.test.ts | integration, skipped offline; truth table incomplete (no share/expiry/purged cases). |
| BR-091 | SERVER-ONLY | SERVER-ONLY | — | document-write.functions.ts:510-512. |
| BR-092 | PARTIAL | ASSERTED | review-rules.test.ts:`BR-092 …` (3 cases) | edit variant, share without date, unknown granter, other subjects. |
| BR-093 | SERVER-ONLY | SERVER-ONLY | share-isolation.integration.test.ts | integration, skipped offline (leak scan only). |
| BR-094 | SERVER-ONLY | SERVER-ONLY | e2e/share-isolation.py | not run in this review. |
| BR-095 | PARTIAL | PARTIAL | document-rules.test.ts:`should let clients record only view and download` | "every other event is written by the operation" is server. |
| BR-096 | ABSENT | ASSERTED | review-rules.test.ts:`BR-096 activity and people lists use 20 rows per page` | |
| BR-100 | ABSENT | ASSERTED | search-rules.test.ts:`BR-100 q ≤200, types ≤30…`; `BR-100 dates, booleans and sort keys` | Schema had no test. |
| BR-101 | ASSERTED | ASSERTED | search-rules.test.ts:`BR-101 q is trimmed and kept…` | |
| BR-102 | PARTIAL | ASSERTED | search-rules.test.ts:`BR-102 page size 50, cursor v is updated_at, name or expiry_date ('' when null)` | expiry/null and the 50 default were untested. |
| BR-103 | ASSERTED | ASSERTED | search-rules.test.ts:`should cap at 10,000`; `BR-103 count cap constant and en-GB grouping` | |
| BR-104 | PARTIAL | PARTIAL | search-rules.test.ts:`BR-104 identifier: 3–64 characters…` | Boundaries now asserted. "offers a jump to the record" is UI. CSV regex `*` restored. |
| BR-105 | ABSENT | PARTIAL | search-rules.test.ts:`BR-105 bulk limit 10,000 in batches of 200` | bulk.tooMany/bulk.empty are server (search.functions.ts:208,214). |
| BR-106 | PARTIAL | ASSERTED | search-rules.test.ts:`BR-106 skip labels are exact`; `BR-106 unchanged: …` | unchanged and five labels were untested. |
| BR-107 | ASSERTED | ASSERTED | search-rules.test.ts:`BR-107 summary lists every reason with en-GB grouping` | |
| BR-108 | SERVER-ONLY | SERVER-ONLY | — | bulk-worker.ts. |
| BR-110 | PARTIAL | ASSERTED | rate-limit-rules.test.ts:`BR-110 defaults are 120 reads and 30 changes per minute…` | Defaults were untested. |
| BR-111 | ASSERTED | ASSERTED | rate-limit-rules.test.ts:`should count GET and HEAD as reads…` | |
| BR-112 | PARTIAL | ASSERTED | rate-limit-rules.test.ts:`BR-112 reset is max(1, 60 − UTC second)…` | second 59 → 1 was untested. |
| BR-113 | PARTIAL | ASSERTED | rate-limit-rules.test.ts:`BR-113 every header on an allowed reply, plus Retry-After on a refusal` | Reset, Policy and X-RateLimit-* were untested. |
| BR-114 | PARTIAL | ASSERTED | rate-limit-rules.test.ts:`BR-114 the 429 message names the limit and the wait…` | Confirmed: only "Wait 20 seconds" was asserted. Full source string recorded below. |
| BR-115 | SERVER-ONLY | SERVER-ONLY | e2e/tmf-rate-isolation.py | SQL api_hit keyed (client_id, kind, window_start); e2e not run. |
| BR-120 | ASSERTED | ASSERTED | event-delivery-rules.test.ts:`BR-120 delivered means HTTP 2xx only` | 199/300 edges added. |
| BR-121 | ASSERTED | ASSERTED | event-delivery-rules.test.ts:`BR-121 backoff table, Retry-After honoured exactly up to 3600 s…` | |
| BR-122 | ASSERTED | ASSERTED | event-delivery-rules.test.ts:`should read Retry-After as seconds or an HTTP date` | See finding F-07 (negative/fractional). |
| BR-123 | PARTIAL | ASSERTED | event-delivery-rules.test.ts:`BR-123 an event created at the same instant as the subscription is delivered` | "at or after" equality was untested. |
| BR-124 | PARTIAL | PARTIAL | event-delivery-rules.test.ts:`BR-124 tolerance is 300 s inclusive…` | Header names set in tmf-events.ts:98-103 (server); constant-time compare not assertable. |
| BR-125 | SERVER-ONLY | SERVER-ONLY | — | claim_event_deliveries (0014_event_deliveries.sql) + tmf-events.ts. |
| BR-126 | PARTIAL | PARTIAL | tmf667-mapper.test.ts:`BR-126 events carry id, href and status only, never document content` | Same-tenant fan-out is server (tmf-events.ts:44). |
| BR-127 | PARTIAL | PARTIAL | tmf667-mapper.test.ts:`BR-127 changed attributes per event kind…`; `BR-127 internal names are delivered as v4 DocumentChangeEvent…` | Spec/source naming discrepancy, see F-01. |
| BR-130 | ASSERTED | ASSERTED | tmf667-mapper.test.ts:`should map every internal state to the v4 DocumentStatusType` | |
| BR-131 | PARTIAL | ASSERTED | tmf667-mapper.test.ts:`BR-131 PATCH status targets, every value, and refusal of anything else` | created/approved/archived and unknown values were untested. |
| BR-132 | PARTIAL | ASSERTED | tmf667-mapper.test.ts:`BR-132 scopes are read, register, transition, approve, hold, delete and subscribe` | Scope list was untested. |
| BR-133 | ASSERTED | ASSERTED | tmf667-mapper.test.ts:`BR-133 BillingAccount maps back to Account…` | |
| BR-134 | PARTIAL | ASSERTED | tmf667-mapper.test.ts:`BR-134 paging: default limit 20, max 100` | Values were untested (only the MAX_LIMIT symbol). |
| BR-135 | ASSERTED | ASSERTED | tmf667-mapper.test.ts:`should accept status= in list queries and intersect it with lifecycleState` | |
| BR-136 | PARTIAL | PARTIAL | tmf667-mapper.test.ts:`BR-136 bearer prefixes…` | 365 d / SHA-256 / 15 min are server (integration-clients.functions.ts:30, tmf-gateway.ts:684). |
| BR-137 | PARTIAL | PARTIAL | tmf667-mapper.test.ts:`should treat private, loopback, link-local and CGNAT addresses as private` | 5 MB / 25 MB / DNS resolve are server (tmf-gateway.ts:39-41, 325-347). |
| BR-138 | SERVER-ONLY | SERVER-ONLY | e2e/tmf-api.py (line 206) | tmf-gateway.ts:656-667; e2e not run. |
| BR-139 | ABSENT | PARTIAL | tmf667-mapper.test.ts:`BR-139 the legacy base /documentManagement/v4 stays an alias with a sunset of 10 May 2027` | Deprecation/Sunset/Link headers are server (tmf-gateway.ts:670-674). |
| BR-140 | PARTIAL | PARTIAL | tmf667-audit-gaps.test.ts:`systemMayApprove` (3 cases) | 409 fourEyesRequired is server (tmf-gateway.ts:449-450); e2e/tmf-api.py:158,389 not run. |
| BR-141 | ASSERTED | ASSERTED | tmf667-audit-gaps.test.ts:`document refs and category`; `document specification` | |
| BR-142 | PARTIAL | PARTIAL | tmf667-audit-gaps.test.ts:`DocumentBatchEvent` (2 cases) | "one per bulk pass" is bulk-worker.ts:103-110. |
| BR-143 | PARTIAL | PARTIAL | document-rules.test.ts:`BR-143 …` (3 cases); document-actions.test.ts:`BR-143 approved content reason` | sensitivity/relatedEntity/externalIdentifier allowed, expired/archived frozen now asserted. 409 approvedContentLocked is server (tmf-gateway.ts:502); e2e/tmf-api.py:265-267 not run. |

## Findings

Verdicts: BLOQUEIA = invariant-related rule (BR-010..013, 020..023, 050..053, 090..095, 115, 120..127, 140) with no asserting test, or a spec text contradicting the source; CORRIGIR = other ABSENT/PARTIAL; NOTA = SERVER-ONLY the rebuild must cover with integration tests.

### BLOQUEIA
- F-B1 BR-053 — retention.functions.ts:197-206. Purge tombstone (purged_at set, content cleared, versions and events kept) has no test at any level. Rebuild must add an integration test: purge → `purged_at` and `deleted_at` set, `description` null, `characteristic` [], storage objects and extraction_fields gone, `document_versions` and `document_events` rows still present, restore refused.
- F-B2 BR-090 — drizzle/migrations/0000 `can_see_document`; access.integration.test.ts and share-isolation.integration.test.ts run only with RUN_ACCESS_TESTS=1 and do not cover shares, expiry, deleted or purged rows. No offline test protects visibility. Rebuild: truth table integration test (same tenant × {tenant_admin, entity_access, share unexpired, share expired} + cross-tenant grant {active, revoked, expired} × {deleted, purged}).
- F-B3 BR-091 — document-write.functions.ts:510-512. `access.crossTenant.off` and `access.subject.sameTenant` have no test.
- F-B4 BR-093 — document.functions.ts:201-218. "record id only if the caller can read that record, never record names" has only the leak scan in share-isolation.integration.test.ts (skipped offline).
- F-B5 BR-094 — only e2e/share-isolation.py (not run). No unit/integration test that revocation takes effect at once on list and direct link.
- F-B6 BR-115 — SQL `api_hit` (0012_tmf667_v4_conformance.sql:27-33) keyed by (client_id, kind, window_start); only e2e/tmf-rate-isolation.py (not run). Per-system isolation is not protected offline.
- F-B7 BR-125 — `claim_event_deliveries` (0014_event_deliveries.sql:22-36) + tmf-events.ts. No test that overlapping passes never send twice or that one subscriber's failure does not re-send to others (e2e/deliver-once.ts exists but is not part of `bun run test`).

### CORRIGIR
- F-C1 BR-127 (spec vs source, owner decides) — docs/rebuild/03-business-rules.md BR-127 lists the event names as "DocumentCreateEvent, DocumentStateChangeEvent (changed: status), DocumentAttributeValueChangeEvent (attachment, characteristic, legalHold), DocumentDeleteEvent (status "deleted")". Source tmf667-mapper.ts:367-385 delivers `DocumentStateChangeEvent` and `DocumentAttributeValueChangeEvent` as **"DocumentChangeEvent"** (TMF667 v4) unless the subscription's query names the old type; the spec names are the internal outbox kinds. The spec should say so (the test `BR-127 internal names are delivered as v4 DocumentChangeEvent…` asserts the source).
- F-C2 BR-017 (spec vs UI text) — spec says "+N more"; src/components/documents/approved-summary.tsx:40 renders "and N more in the list below". The pure rule (count) is asserted; the label is UI and not in the oracle. Owner decides the string; the rebuild should not copy "+N more" blindly.
- F-C3 BR-030 — spec's guided-UI words "Confirm, Correct and 'Not in this document'" exist in src/components/review/field-row.tsx:122-125 and done-words "Confirmed / Corrected / Not in this document" at :34, but no test asserts them. Rebuild: component test.
- F-C4 BR-004, BR-010, BR-011, BR-013, BR-020, BR-022, BR-060, BR-071, BR-072, BR-095, BR-105, BR-136, BR-137, BR-139, BR-140, BR-142, BR-143 — pure part asserted in this branch; the error code / HTTP status named by the rule is produced only on the server (see `target_test_suggestion` in 16-traceability.csv for the exact integration case each needs).
- F-C5 BR-023 — no code path stores extracted fields in src/services (the reading step was not found in pipeline.functions.ts or the migrations by grep); the invariant "never auto-accept" is asserted only on the gate side (pending stays pending whatever the confidence). Rebuild: integration test that the extraction writer always inserts status `pending`. Also note tenant-rules.ts:64 and policy-cards.tsx:9 still carry an `autoAcceptConfidenceAtLeast` floor ("Automatic acceptance needs at least N% confidence."), which contradicts BR-023 in the UI copy even though nothing acts on it.
- F-C6 BR-056 — only the manage requirement is unit-visible (through bulkSkipReason); recording reason/reference/set-by (document-write.functions.ts:395-403) needs an integration test.
- F-C7 BR-122 (cross-check of the other pass's `it.fails`) — event-delivery-rules.ts:19-25: `parseRetryAfter("-2999")` and `"2999.5"` fall through to `Date.parse`, which accepts them as years, so they return 0 instead of null. Spec says "An invalid value is ignored". Owner decides (treat as invalid → fix source; or accept → correct the spec).
- F-C8 BR-124 — header names `X-Signature`, `X-Signature-Timestamp`, `X-Event-Id` are set in tmf-events.ts:98-103 and have no test; constant-time comparison cannot be asserted by a unit test (document in the rebuild's review checklist).

### NOTA (SERVER-ONLY, rebuild integration tests)
- BR-003 (user_roles_guard), BR-040 (reviewExtraction copy + audit without value), BR-054 (soft delete / restore), BR-087 (effective_specifications), BR-108 (bulk per-document re-check and audit), BR-138 (404/405 TMF JSON, e2e/tmf-api.py:206 covers it when run).
- Source strings the spec paraphrases or omits (recorded so the rebuild returns them verbatim; no contradiction):
  - BR-039: "Differs from the record. Compare with the page." / "Matches the record."
  - BR-082: "<group> lets this organisation add to its types, not replace their settings."
  - BR-114: "This system has used its allowance of 30 changes per minute. Wait 20 seconds (see Retry-After) and send the request again. Other connected systems are not affected. An administrator can raise this system's allowance in Admin > Connected systems."
  - BR-143 (UI reason, document-actions.ts:44): "This document is approved, so its content stays as it was approved. You can still rename it or update its description."
  - BR-140 (TMF 409 message, tmf-gateway.ts:450): "The system that added this document can't approve it. Another system or a person in the app can."
  - BR-143 (TMF 409 message, tmf-gateway.ts:502): "This document is approved, so only name, description, externalIdentifier and relatedEntity can change. Not changed: <fields>."
- BR-001: ROLE_RANK numbers are not exported; the rank is observable only as the capability table. Fine for the oracle, but the rebuild's Java enum should be checked by the same table, not by numbers.
- Traceability CSV fixes: BR-143 row had 4 columns (no target); BR-104 regex had lost its `*`; `current_test` named document-actions.test.ts for BR-001..013 and tenant-rules.test.ts for BR-050..056 where those files assert nothing of the kind; integration/e2e files are now marked "RUN_ACCESS_TESTS=1 only" / "not run in this review".
- Spec texts verified identical to source (no change needed): BR-015, BR-016, BR-021, BR-022, BR-026, BR-037, BR-038, BR-042, BR-051, BR-052, BR-063, BR-064, BR-065, BR-066, BR-081, BR-083, BR-084, BR-085, BR-086, BR-092, BR-103, BR-106 (labels), BR-107.

## Fixed in this branch / goes to the rebuild / owner's decision

| fixed in this branch (tests only, uncommitted) | goes to the rebuild (integration/e2e/component) | owner's decision |
|---|---|---|
| 89 new `it` cases in the ten pure-module test files; every quoted string in BR-014..016, 021, 022, 026, 030, 031, 037..039, 041..043, 051, 052, 063..066, 081..086, 092, 106, 107, 114 asserted literally; constants for BR-061, 072, 096, 102, 105, 110, 121, 124, 132, 134, 139 pinned; BR-100 schema bounds; BR-104 boundaries; BR-131 full table; 16-traceability.csv rewritten with `status` column | F-B1..F-B7 (BR-053, 090, 091, 093, 094, 115, 125); NOTA rules BR-003, 040, 054, 087, 108, 138; server error codes listed in F-C4; BR-023 extraction writer; BR-056 hold fields; BR-124 headers; BR-030/BR-017 component texts | F-C1 BR-127 event names (spec vs v4 source); F-C2 BR-017 "+N more" vs "and N more in the list below"; F-C7 BR-122 negative/fractional Retry-After; F-C5 the dormant `autoAcceptConfidenceAtLeast` floor text vs BR-023 |

Constraints respected: no production code under src/ changed (tests only), src/components/ui untouched, no Prettier, no commit, no git write, hosted Supabase not called, e2e not run, no password printed.
