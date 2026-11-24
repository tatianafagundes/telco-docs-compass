# File hooks: tasks

Every task: `bun run check` passes; one kind of change per commit; every fix has a test that fails without
it; English only. "Review" tasks are done by the named agent on the diff of that phase; findings are fixed
before the next phase. Requirements: `requirements.md`; design: `design.md`.

## 0. Decisions and requests
- [x] 0.1 D1, D2 and D8 confirmed (2026-11-24): switch column and trigger written in this repo.
- [x] 0.2 Migrations `0016_file_hooks.sql` (switch, file-event trigger, hold branch), `0017_file_hooks_safe_attempt.sql` (a malformed attempt never blocks an update) and `0018_file_hooks_hardening.sql` (seg-review M1, L1–L3: hold value not sent, empty search_path, version bound to document and tenant, two events for a combined change); `src/test/file-hooks-trigger.test.ts` runs them on PGlite, `src/test/file-hooks-migration.test.ts` guards the payload keys. After publishing: confirm on the preview that the migration applied (an upload emits `DocumentFileStoredEvent`).
- [x] 0.3 Docs: align names in `docs/rebuild/18-tenancy-and-data-protection.md` (D7) and add BR rules for R1–R6 in `docs/rebuild/03-business-rules.md` (BR-150 to BR-162).

## 1. Pure rules (no I/O)
- [x] 1.1 `file-hook-rules.ts`: opt-in set, whitelist, payload builders. Tests: null, empty, other-type queries get none; extra keys, `__proto__`, wrong types never pass (R1.5, R1.6).
- [x] 1.2 `stepTransition` for every state, result, attempt and quarantined version (R2.4, R3.5, R4.4, D5). Table test.
- [x] 1.3 Download rule table (design) (R2.1, R3.1, D5).
- [x] 1.4 Field validation (R3.3): unknown and duplicate names, types, control and bidi characters, limits at N and N+1 (code points), confidence edges, `source` pattern, `engine`/`threatName` charset.
- [x] 1.5 Limits added to `docs/architecture/limits.md` (limits-doc test).
- [x] 1.6 Review: `code-reviewer` on phase 1: approved with 8 should-fix findings, all fixed (comparable attempt guard, quarantine never shortened, external result checks and replay, timeout checks the wait, external owner names its system, step from reason, unsafe text incl. lone surrogates, names cut by code points); 16 mutations of the rules each caught by a test.

## 2. Server pipeline (simulated path made safe)
- [x] 2.1 `pipeline.functions.ts` (core in `pipeline-step.ts`): guarded updates (state, version, `pipeline_detail->>attempt` from `expect.attemptText`; needs a jsonb guard next to `updateDocumentIf`); `pipeline_detail` with mode, since, step, attempt; Try again restarts the failed step; server SHA-256 on confirm (R4.3, R4.4, R1.1).
- [x] 2.2 `externalPending` and the waiting flag when a step is external (R4.2). Test: an editor cannot advance an external scan or retry past it.
- [x] 2.3 `addVersion` (now `document-add-version.ts`) carries `carriedQuarantine(...)` and is refused when `quarantineHasRoom` is false; restore rule (R4.8, D5).
- [x] 2.4 Review: `seg-review` on phases 1–2: BLOCK with H1–H5, M1–M6, L1–L5. Fixed: H1 (Keep without reading guarded and only for reading failures), H2 (addVersion guarded), H3 (server hash compared in both stored forms; full 64-hex hash required), M2 (size checked, 25 MB cap, 1 MB sniff), M3 (restore refused when it shares the file or bytes with a quarantined version), M4 (attempt carried; results name the version), M6 (API-registered documents can be processed), L1, L2 (request-shape test with the real client). Each fix has a test; 9 mutations caught.
- [x] 2.6 Review: `qa-test-engineer` adversarial pass on phases 1–2 (`qa-file-hooks-{rules,pipeline,trigger}.test.ts`, 204 tests, real Postgres via PGlite for the trigger and the jsonb guard). 16 defects; fixed: the restore's same-file check failed open and sent the whole list in the URL; subscription filters (`%2C` lists, prefix and unanchored names, a stray `%`); hold plus status change and ReadyToRead version binding (migration 0019); attempts stored as text or out of range now refused; version ids compared in any case; Keep without reading refuses a quarantined version; years 0–99; link-like sources; more invisible characters; FakeDb `eq.null`, uuid case and jsonb text as in PostgREST. Known and left: a row hand-written with `{"attempt": 3.0}` can never be written by the guard (JavaScript reads 3; Postgres's text is "3.0"), pinned by an `it.fails`.
- [ ] 2.5 Carried to later phases, release gates:
  - H4 (API inline content goes straight to `ready`): closed in 5.3.
  - H5 and M1 (downloads in `uploading`, `failed` after a scan, older quarantined versions): closed in 5.5. Check `e2e/tmf-api.py` for a link expected while uploading or failed (8.4).
  - A version superseded before its scan finished: closed in 5.7 (only the current version is downloaded).
  - M5: the scan is simulated; no release may claim scanning while every owner is simulated.
  - L3/L4: check the hosted data for `failed` rows without a step and quarantined documents whose list was cleared by the old addVersion.
  - L5: uploads that never pass the hash wait for the timeout in 6.1.
  - A version row inserted before a lost race stays as an unused version (versions are immutable); a database function that locks the row would remove this.
  - A restore on a seeded document waits in `uploading` (seeded documents never move).
  - zod 3.25.76 advisory GHSA-mrhx-c7xc-m3w5 (separate ticket).
  - The storage bucket's own size limit must be at most 25 MB (`MAX_PROCESS_BYTES`): the download is buffered before the size can be checked. Not visible in the repo; check the hosted bucket.
  - Metadata edits (name, sensitivity, expiry) are decided from an earlier read and not guarded on `status` or `legal_hold`; older than this spec, to fix separately.
  - Publishing to `main` behind the preview is accepted on these conditions: preview access restricted, no real customer or personal files, no wording that files are scanned or safe. 5.3 and 5.5 are closed; the rest of this list stays open as release blockers.

## 3. Organisation switch and keys
- [x] 3.1 `external-processing.ts`: switch read from `tenants.external_processing`, active scanner and reader, `startStep`.
- [x] 3.2 Scopes `scan`, `extract`: D3 and D4 at creation (admin only, recorded) and in `authenticate`; `ALL_SCOPES` in the test world updated on purpose. Done: `processing-keys.ts` (pure), `integration-client-create.ts` (D3, D4, recorded), `authenticate` re-check (403 `notDesignated`, 503 when the keys cannot be read), migration 0020 (CHECK and partial unique index), `setProcessingSwitch` / `getProcessingSwitch` (organisation administrator, recorded), `resolveOwners` wired into `advancePipeline`, `ALL_SCOPES` kept without the exclusive scopes, `e2e/tmf-api.py` skips them for "all scopes". A switch on with no active key gives an external step with no system (waits, then times out).
- [x] 3.3 Review: `seg-review` on phase 3: PASS WITH FINDINGS (no Critical/High). Fixed: M1 lost update on the switch and M2 audit after the effect (atomic `set_external_processing`, compensation on key creation, disconnect records first and finishes on retry), M3 processing-key check after the rate limit with a scope filter, L1 switch shape CHECK, L3 key rotation recorded, L5 names cleaned, L7 no token for a non-designated key. Left, with reasons:
  - L2: migration 0020's CHECK validates existing rows; no row can hold `scan`/`extract` before this release (the scopes did not exist), and the table is small. Run `select count(*) from integration_clients where scopes && array['scan','extract']` before applying if in doubt.
  - L4: any member can read `external_processing` through the database (tenants are readable by members); accepted, it says only whether the organisation's own antivirus and reader are on.
  - L6: turning the antivirus off needs a strong warning and confirmation in the screens (7.4); no second approval.
  - For phases 4–5: answers and downloads are authorised with `scan`/`extract` only, never by widening `read`; an external step with no system (`by` null) must show "no system connected" and is never offered to anyone; Try again resolves the owner as it is now (the spec's rule), a document keeps its mode only while its step lasts.

## 4. Events out
- [x] 4.1 Tests that every path that changes `pipeline_state` or purges goes through the guarded update the trigger listens to; no app-side event inserts for the file events (R1.1–R1.4).
- [x] 4.2 `tmf667-events.ts`: `OPT_IN_EVENTS` before the no-query branch and then the status and type filters (seg-review M2); hold changes give `changedAttributes: ["legalHold"]` without the value (R1.3, R1.5); `file-events-opt-in.test.ts`. Done early: the trigger writes the events as soon as the migration applies.
- [x] 4.3 Test that no sensitive string (description, hold reason, value, threat name, person name) reaches any outbox row or delivered body (R1.6, R6.4). Done: `file-events-paths.test.ts` (static, reviewed writers), `file-events-no-content.test.ts` (PGlite, every event kind, delivered bodies, poisoned payloads). Logs are spied in 5.6 with the callbacks, which are the first code that handles threat names and values.
- [x] 4.4 Review: `code-reviewer` on phases 3 and 4: APPROVED with S1–S8. Fixed: the tripwire now reads the TypeScript syntax tree of all of `src` plus the migrations (11 bypasses it missed, each now caught), rotation recorded first, a failed take-back of an unrecorded key is logged, one designation helper for `authenticate` and `issueToken`, media types restricted to type/subtype. S7 (0020's CHECK on existing rows) does not apply: 0020 and the creation checks were published in the same push, so no processing key could exist before the constraint. Open, for 5.3: API inline content still goes straight to `ready` (H4, Q1).

## 5. Callbacks and confirm upload
- [x] 5.1 `gateway-file-results.ts` `postScanResult` with the check order of R2.3, receipt check (`file-result-receipts.ts`), idempotency per document, version and attempt, R2.8. The built-in reading runs in the same request after `clean`.
- [x] 5.2 `postExtractionResult` (R3): fields checked as a whole, saved as pending proposals from the system (`file-result-fields.ts`), a person's row kept, proposals taken back when the document moved meanwhile.
- [x] 5.3 `confirmUpload` (R4.6, `gateway-file-upload.ts`); API inline and url files stored as `uploading` and run through the steps by `processAsSystem` (H4 closed).
- [x] 5.4 Routes and legacy twins for `scanResult`, `extractionResult`, `uploaded`; `gateway-api.ts` exports; route `AGENTS.md` rule.
- [x] 5.5 `downloadDecision` in `gateway-reads.ts` and `getContentUrl`: only checked files, never a quarantined version, the scanner or reader only in its own step; tests and the old uploading/failed contract changed (H5, M1 of 2.5 closed).
- [x] 5.6 Tests: `gateway/file-results.test.ts`, `gateway/file-downloads.test.ts`, the QA files below; every refusal with no write, races with stubbed reads, tenant isolation incl. version ids, logs spied for values and threat names.
- [x] 5.7 Review: `seg-review` BLOCK (H1, M1, M2, L1–L8) and `qa-test-engineer` (`gateway/qa-file-results-{scan,extract,flow,upload,download,routes}.test.ts`, 7 defects D1–D7). Fixed, each with a test and a mutation caught:
  - H1: people and `read` keys download only the current version (`notCurrent`); an older one may never have been scanned.
  - M2: a version declared over 25 MB is refused before it is fetched into memory.
  - L1: a system's activity is cut before ` · via <system>`, the name cleaned of control and direction characters; L4: the server's steps record the version.
  - L2: a reader's detail is one plain value (string, number, boolean); nested data is refused before hashing.
  - L3: a malformed id is 404 before its Idempotency-Key is remembered (all three callbacks).
  - D1: the built-in reading keeps the scanner's `lastResult`, so a lost reply to `clean` is answered again.
  - D2: an error reading the specifications answers 503, not 400 `unknownFields`.
  - D3: `MAX_RESULT_BODY_BYTES` 1 000 000 (bytes), room for 100 details of 2000 characters in any script.
  - D5: a download link is given only after its record (receipt or activity) is written; else 503.
  - D7: a failed take-back is logged with row ids, never a value.
  - Decided: D4 a quarantined document answers `quarantined` (R2.3 updated); D6 "escaped" means JSON-encoded with unsafe characters replaced, answers sent with `nosniff`; `notDesignated` is the one code for scanners and readers (R2.3 updated).
- [x] 5.7b Re-check: `seg-review` PASS WITH FINDINGS; H1 confirmed closed. Fixed: a failed document with a reason but no step (a legacy timeout) is never a checked file; token answers carry `nosniff` too.
- [ ] 5.8 Carried, with reasons:
  - seg M1: a person adding a detail between the reader's check and its insert gives a second, pending row for that name (no unique index on version and name). The person's row is kept and the proposal waits for review, so nothing is applied silently. A unique index needs a check of the hosted rows first; with 8.5.
  - seg L5: the scan receipt is not bound to a client id. One processing key of each kind per organisation (BR-163) makes the designated system the only one that can download in the step; a rotated key keeps the same client.
  - seg L7: a failure in the middle of `processAsSystem` leaves a simulated step where it stopped. A person's Check now or the scheduled run (6.1) moves it on.
  - seg L8: a 403 `notYourStep`/`notDesignated` tells a key of the same organisation that a document exists; accepted, the key already reads its organisation's documents.
  - M2 rest (seg re-check: Medium, open): the declared size is checked first, but both downloads still buffer the whole stored object before its real size is known, so a file uploaded larger than declared is read into memory. Release gate: the bucket's own limit at most 25 MB (2.5), or stream from a signed address with `readResponseBytes` and `MAX_PROCESS_BYTES`. createDocument also fetches the file it just stored; reuse the bytes later.
  - seg re-check: `reviewExtraction` does not check that the field's version is still current or that the field is still pending; guard both with 8.5.
  - seg re-check: a download link already given stays valid for its 60 seconds (300 for a preview) if the version is quarantined meanwhile; stated in the API guide.
  - Hand-written `{"attempt": 3.0}` rows stay unwritable (one `it.fails`, 2.6).

## 6. Timeouts and alerts
- [x] 6.1 Timeout step in the scheduled run (R4.7): `file-hook-sweep.ts` `timeOutWaitingSteps`, called by `runMaintenance` (step `stepTimeouts`, `timedOutSteps` in the result). Guarded on state, version and attempt; seeded, deleted, purged and version-less documents left out in the query; records `pipelineStateChange` against the version; does not read keys, so a disconnected antivirus still times out. Tests `file-hook-sweep.test.ts` (boundaries at N and N+1 ms, every tenant, batch, races, failures).
- [x] 6.2 Quarantine-rate alert (R6.5): `file-result-alerts.ts` after each accepted infected result; alert line with ids and counts only; a failed count is logged and never changes the answer. FakeDb gained `like`, `not` and `or`.
- [x] 6.3 Review: `code-reviewer` CHANGES REQUESTED (M1, S1–S4, nits, Q1–Q2). Fixed, each with a test and a mutation caught:
  - M1: the batch was cut before filters that remove rows, so stuck rows could starve due ones. Now filtered in the query (seeded, no version, wait possibly over: an upload unchanged for 24 h, a step started or changed more than 30 min ago; timestamps quoted for PostgREST); a full batch that moves nothing is logged (`noProgress`).
  - S1: the documents already moved get their record even when a later write fails; a failed record names the documents.
  - S2: the activity detail of an infected result is built from the prefix the alert counts.
  - S3: the batch test now moves more than a batch over two runs.
  - S4: decided: an alert line on every infected result past the limit (alerting deduplicates).
  - Nit: an unexpected error in the count is logged as a fixed word.
  - Q2: `readDetail` drops an unreadable start time, so the step counts from the last change.
- [ ] 6.4 Carried: `document_events` has no index for the receipt check and the alert count (Q1). Add `(tenant_id, document_id, version_id, action)` and `(tenant_id, action, created_at)` in a new migration with 8.5, after checking the hosted table size.

## 7. Screens
- [x] 7.1 Copy and actions by reason and step (R5.2, R5.3), one pure rule for every screen (`src/lib/pipeline-copy.ts`): the card, the panel notice (`processing-notice.tsx`) and the record table; tooltip only for a built-in step (R5.1). Found on the way: an old timeout that recorded no step now scans again on Try again and is never kept without reading (it may have been the scan).
- [x] 7.2 The record list refetches every 5 s, then 15 s after 2 minutes, only while a shown document waits for an outside system; React Query pauses while the tab is hidden and refetches on return; Check now with "Checked HH:mm"; "Can't refresh right now" banner. The upload card follows the list for rows the page is not walking (`useUpload.sync`).
- [x] 7.3 Announcements (`processing-announcer.tsx`): polite for steps, alert for failures and blocked files, one keyed element each, focus never moved.
- [x] 7.4 Connected systems: labels, the switch card with confirmation and the weaker-protection warning (`processing-switch.tsx`, `api.get/setProcessingSwitch`), disconnect warning for the system files wait for, name help, processing permissions exclusive in the dialog.
- [x] 7.5 Component tests (`pipeline-copy.test.ts`, `processing-screens.test.tsx`, `processing-switch.test.tsx`, `use-upload-sync.test.tsx` with fake timers and no leaked timers; text-only rendering of system names). Browser check: a gallery of the real components with a stubbed API (outside the repo), light and dark, axe-core 4.10 WCAG 2.2 AA: 0 violations in 9 states each. The record page itself was not captured (its server functions need the service key); judged from code.
- [x] 7.6 Review: `design-review` (`docs/design/file-hooks-screens-review.md`): 3 blockers, 10 shoulds, 8 nits. Fixed B1–B3, S1–S10, N2, N6, N7; round 2 captured with 0 axe violations. Left with reasons: N1, N3, N4, N5, N8. Before release: a person checks the announcements with a screen reader (R5.7).

## 8. Documentation and release
- [ ] 8.1 `docs/integration/tmf667-api.md`: scopes, the three endpoints with examples, events, residual risk (R6.6), how a scanner must hash the bytes it downloaded.
- [ ] 8.2 `docs/rebuild/06-api/tmf667.md`, OpenAPI contract (extensions marked non-standard), `bun run sync:rebuild`.
- [ ] 8.3 Screens docs (`record.md`, `admin-systems.md`), `accessibility.md`, `regression-after-publish.md`, `roadmap.md`.
- [ ] 8.4 `e2e/file-hooks.py`: scanner key on a test tenant; clean, infected, replay, stale attempt, hash mismatch, other tenant 404; revokes the key at the end.
- [ ] 8.5 Final multi-perspective review of the whole range (`code-reviewer`, `seg-review`, `qa-test-engineer`, `design-review`); fix findings.
- [ ] 8.6 Per-commit check, full regression, gitleaks; human security review sign-off (R6.6); publish to `main`; run `e2e/file-hooks.py` on the preview and record the result.
