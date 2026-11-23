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
  - H4 (API inline content goes straight to `ready`) in 5.3.
  - H5 and M1 (the API and screens download in `uploading`, `failed` after a scan, and older quarantined versions) in 5.5: apply `downloadDecision` in `gateway-reads.ts` and `getContentUrl`, and change the tests and `e2e/tmf-api.py` that expect a link while uploading or failed.
  - Also in 5.5: a version that was superseded before its scan finished must not be downloadable (no per-version clean record exists yet).
  - M5: the scan is simulated; no release may claim scanning while every owner is simulated.
  - L3/L4: check the hosted data for `failed` rows without a step and quarantined documents whose list was cleared by the old addVersion.
  - L5: uploads that never pass the hash wait for the timeout in 6.1.
  - A version row inserted before a lost race stays as an unused version (versions are immutable); a database function that locks the row would remove this.
  - A restore on a seeded document waits in `uploading` (seeded documents never move).
  - zod 3.25.76 advisory GHSA-mrhx-c7xc-m3w5 (separate ticket).
  - The storage bucket's own size limit must be at most 25 MB (`MAX_PROCESS_BYTES`): the download is buffered before the size can be checked. Not visible in the repo; check the hosted bucket.
  - Metadata edits (name, sensitivity, expiry) are decided from an earlier read and not guarded on `status` or `legal_hold`; older than this spec, to fix separately.
  - Publishing to `main` behind the preview is accepted on these conditions: preview access restricted, no real customer or personal files, no wording that files are scanned or safe, 3.x, 5.3 and 5.5 open as release blockers.

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
- [ ] 4.4 Review: `code-reviewer` on phase 4.

## 5. Callbacks and confirm upload
- [ ] 5.1 `gateway-file-results.ts` `postScanResult` with the check order of R2.3, receipt check, idempotency per document, version and attempt, R2.8.
- [ ] 5.2 `postExtractionResult` (R3).
- [ ] 5.3 `confirmUpload` (R4.6); `gateway-create.ts` ordering (R4.5).
- [ ] 5.4 Routes and legacy twins; `gateway-api.ts` exports; route `AGENTS.md` rules.
- [ ] 5.5 `gateway-reads.ts` download rule (scanner, reader, quarantined versions).
- [ ] 5.6 Tests: every refusal with no write (`writesTo` empty); races with `fireWriteHook`; tenant isolation incl. version ids; 429 changes nothing; logs spy.
- [ ] 5.7 Review: `seg-review` (verdict control, isolation, injection, DoS) and `qa-test-engineer` (adversarial gaps).

## 6. Timeouts and alerts
- [ ] 6.1 Timeout step in the scheduled run (R4.7) with injected `now`; boundary tests; scanner revoked mid-scan still times out.
- [ ] 6.2 Quarantine-rate alert (R6.5).
- [ ] 6.3 Review: `code-reviewer` on phase 6.

## 7. Screens
- [ ] 7.1 Copy and actions by reason and step (R5.2, R5.3); tooltip only for simulated (R5.1).
- [ ] 7.2 One list refetch with backoff, hidden-tab pause, Check now, refresh error (R5.4).
- [ ] 7.3 Announcements: polite status per change, alert for failures and quarantine (R5.5).
- [ ] 7.4 Connected systems: labels, switch with confirmation, disconnect and switch-off warnings, name help (R5.6).
- [ ] 7.5 Component tests (fake timers, no leaked intervals, text-only rendering of values and system names); browser check light and dark with axe.
- [ ] 7.6 Review: `design-review` on the captures of every state; fix findings.

## 8. Documentation and release
- [ ] 8.1 `docs/integration/tmf667-api.md`: scopes, the three endpoints with examples, events, residual risk (R6.6), how a scanner must hash the bytes it downloaded.
- [ ] 8.2 `docs/rebuild/06-api/tmf667.md`, OpenAPI contract (extensions marked non-standard), `bun run sync:rebuild`.
- [ ] 8.3 Screens docs (`record.md`, `admin-systems.md`), `accessibility.md`, `regression-after-publish.md`, `roadmap.md`.
- [ ] 8.4 `e2e/file-hooks.py`: scanner key on a test tenant; clean, infected, replay, stale attempt, hash mismatch, other tenant 404; revokes the key at the end.
- [ ] 8.5 Final multi-perspective review of the whole range (`code-reviewer`, `seg-review`, `qa-test-engineer`, `design-review`); fix findings.
- [ ] 8.6 Per-commit check, full regression, gitleaks; human security review sign-off (R6.6); publish to `main`; run `e2e/file-hooks.py` on the preview and record the result.
