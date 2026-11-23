# File hooks: tasks

Every task: `bun run check` passes; one kind of change per commit; every fix has a test that fails without
it; English only. "Review" tasks are done by the named agent on the diff of that phase; findings are fixed
before the next phase. Requirements: `requirements.md`; design: `design.md`.

## 0. Decisions and requests
- [ ] 0.1 Product owner confirms D1, D2 and D8 (switch storage, trigger, timeouts).
- [ ] 0.2 Send the two Lovable requests (design "Lovable requests"); record the answer in `roadmap.md`.
- [ ] 0.3 Docs: align names in `docs/rebuild/18-tenancy-and-data-protection.md` (D7) and add BR rules for R1–R6 in `docs/rebuild/03-business-rules.md`.

## 1. Pure rules (no I/O)
- [ ] 1.1 `file-hook-rules.ts`: opt-in set, whitelist, payload builders. Tests: null, empty, other-type queries get none; extra keys, `__proto__`, wrong types never pass (R1.5, R1.6).
- [ ] 1.2 `stepTransition` for every state, result, attempt and quarantined version (R2.4, R3.5, R4.4, D5). Table test.
- [ ] 1.3 Download rule table (design) (R2.1, R3.1, D5).
- [ ] 1.4 Field validation (R3.3): unknown and duplicate names, types, control and bidi characters, limits at N and N+1 (code points), confidence edges, `source` pattern, `engine`/`threatName` charset.
- [ ] 1.5 Limits added to `docs/architecture/limits.md` (limits-doc test).
- [ ] 1.6 Review: `code-reviewer` on phase 1.

## 2. Server pipeline (simulated path made safe)
- [ ] 2.1 `pipeline.functions.ts`: guarded updates (state, version, attempt); `pipeline_detail` with mode, since, step, attempt; Try again restarts the failed step; server SHA-256 on confirm (R4.3, R4.4, R1.1).
- [ ] 2.2 `externalPending` and the waiting flag when a step is external (R4.2). Test: an editor cannot advance an external scan or retry past it.
- [ ] 2.3 `addVersion` carries `quarantinedVersions`; restore rule (R4.8, D5).
- [ ] 2.4 Review: `seg-review` on phases 1–2 (scan bypass, TOCTOU, quarantine per version).

## 3. Organisation switch and keys
- [ ] 3.1 `external-processing.ts`: switch with D1 fallback, active scanner and reader, `startStep`.
- [ ] 3.2 Scopes `scan`, `extract`: D3 and D4 at creation (admin only, recorded) and in `authenticate`; `ALL_SCOPES` in the test world updated on purpose.
- [ ] 3.3 Review: `seg-review` on phase 3.

## 4. Events out
- [ ] 4.1 `file-hook-events.ts`: Stored, ReadyToRead, Purged written after the guarded update; purge lists removed version ids; reset does not emit (R1.1–R1.4).
- [ ] 4.2 `tmf667-events.ts`: opt-in set before the no-query branch; whitelist; `legalHold` on change events only when it changed (R1.3, R1.5, R1.6).
- [ ] 4.3 Test that no sensitive string (description, hold reason, value, threat name, person name) reaches any outbox row or delivered body (R1.6, R6.4).
- [ ] 4.4 Review: `code-reviewer` on phase 4.

## 5. Callbacks and confirm upload
- [ ] 5.1 `gateway-file-results.ts` `postScanResult` with the check order of R2.3, receipt check, idempotency per document, version and attempt, R2.8 and R2.10.
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

## 9. When Lovable delivers (D1, D2)
- [ ] 9.1 Switch read from the new column; remove the D1 fallback; test.
- [ ] 9.2 Remove app-side emission and R2.10 repair; test that the trigger's events match the whitelist.
- [ ] 9.3 Review: `code-reviewer`; docs updated.
