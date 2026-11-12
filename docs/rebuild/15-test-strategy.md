# 15 — Test strategy for the rebuild

**Goal:** prove the Java and Angular app behaves exactly like the reference app. The current app is the oracle. `15b-test-inventory.md` lists all 334 existing assertions, from unit tests and end-to-end scripts, that need an equivalent.

## Test pyramid
| Layer | Tooling | What | Count target |
|---|---|---|---|
| Rule unit tests | JUnit 5 + AssertJ, `@ParameterizedTest` | One test class per `*Rules` class, ported 1:1 from `reference/rule-tests/*.test.ts` with the **same example values and expected strings** | ≥ 142 (current `it` count), plus one test per BR id |
| Access truth table | JUnit, generated cases | `canSee` across all combinations (see 04), compared with `can_see_document` | ~500 cases |
| Repository / integration | Testcontainers: Cassandra 5, OpenSearch, Keycloak, MinIO | Batches, LWT status races, idempotency replay and conflict, outbox → index, rate counters, delivery claims | ~60 |
| API contract | RestAssured + OpenAPI validator (`contracts/seams/*.yaml`); the official TMF667 v4 swagger for standard operations | Every operation, every documented error code | 1 per operation × status |
| Parity scenarios | Language-neutral Given/When/Then (Cucumber, or the existing Python scripts pointed at the new base URL) | Ports of `e2e/tmf-api.py` (97 checks), `tmf-events.py` (43), `tmf-rate-isolation.py` (16), `share-isolation.py` (13 + reply scans) | 169+ |
| UI journeys | Playwright + axe-core | Sign in, search, open, add files, check details, approve (with four-eyes), make effective, share and remove share, hold and release, delete and undo, admin types with lock, connected systems | ~25 journeys × 3 widths (1280, 792, 720 as 200 % zoom) × 2 themes, keyboard-only, with axe-core (`color-contrast` also on hover and selected states, `target-size`), `forcedColors` and `reducedMotion` passes, and a `:focus` assertion after every dialog close, panel close and navigation |
| Load | k6 or Gatling, seed of 1–5M documents | Search, facets, capped count, bulk 10,000, API at configured limits, event fan-out | Targets in 08 and 14 |
| Architecture | ArchUnit | No controller → repository; the master module has no document DTOs; rule classes have no I/O | 5 rules |

## Parity scenarios (examples; write all of them)
```gherkin
Scenario: Norway manager cannot see Sweden through direct links (L1)
  Given I am signed in as no.manager@example.test
  When I open /records/quo-se-0412 and /records/quo-se-0412/review/<d2>
  Then the page says "This record isn't available to you"
  And no server reply contains "Q-2026-0412", "quo-se-0412" or "<d2>"

Scenario: Removing a share removes access at once (BR-094)
  Given se.manager shared document D with se.viewer
  And se.viewer sees D in "Shared with me" and can open /shared/D
  When se.manager removes the share
  Then se.viewer no longer sees D in the list and /shared/D says not available

Scenario: Four-eyes (BR-022)
  Given se.manager added document D and all required details are confirmed
  When se.manager tries to approve D
  Then approval is refused with "Someone other than the person who added it needs to approve it."
  And se.admin can approve D

Scenario: One system cannot exhaust another (BR-115)
  Given systems A and B each with a limit of 5 changes per minute
  When A sends 6 changes
  Then A's 6th gets 429 with Retry-After and RateLimit-* headers
  And B's next change succeeds

Scenario: Failing subscriber does not cause duplicates (BR-125)
  Given subscribers S1 (healthy) and S2 (returns 500) on the same tenant
  When one document changes and three delivery passes run, two of them overlapping
  Then S1 receives the event exactly once, with a valid signature
  And S2 receives up to 6 attempts with backoff, then delivery gives up

Scenario: TMF status mapping (BR-130)
  When a system GETs /document?status=published
  Then every result has lifecycleState "effective"
```

## Fixtures
- `fixtures/synthetic-seed.sql`: the reference seed (tenants, records, specifications, documents, details). Convert it into CQL and OpenSearch bulk files with a seed tool, and keep the ids identical so the scenarios run unchanged.
- Demo users come from `12-keycloak.md` (realm import).
- Test-only hooks: file names ending `.exe`, or file text containing TEST-QUARANTINE or TEST-UNREADABLE, drive the simulated pipeline (BR-062).
- A master-admin reset removes test artefacts.

## Acceptance checklist
- [ ] Every BR id in `16-traceability.csv` has a passing target test.
- [ ] Every line in `15b-test-inventory.md` has a passing equivalent.
- [ ] Both OpenAPI contracts validate, and TMF standard operations validate against the official swagger.
- [ ] The leak scans (L1–L6) find nothing.
- [ ] axe-core shows no serious or critical issues on any screen, in either theme or at any width, including hover and selected states; a unit test over `tokens.css` rejects any text pair below 4.5:1 and any UI pair below 3:1 in either theme.
- [ ] Bulk approve refuses the document's own creator (four-eyes on the bulk path, BR-022/BR-108); search and `find` replies for `no.manager` contain no Sweden record id or record type (L1, BR-093).
- [ ] Load targets are met at 5M documents.
- [ ] The rebuild reaches the same answers as the reference app for the same seed (diff the API responses, ignoring timestamps and ids).
