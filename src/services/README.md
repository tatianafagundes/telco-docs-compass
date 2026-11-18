# Services

## Purpose

All the server-side logic of the app: the rules about documents, the three ways a document is changed (screens, the TMF API for other systems, bulk changes), and the scheduled background work. Screens and routes stay thin and call into this folder.

## What it does NOT do

- No UI and no routing (see `src/routes/` and `src/components/`).
- No SQL schema or row-level security: those live in `drizzle/` and are owned by the database side. A test here proves the application's own checks, not what the database enforces.
- No secrets in code. The privileged database client is only loaded inside server handlers.

## Files

Pure rules (no I/O, safe to call from anywhere):

| File                                                                                                                                                                | What it decides                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `document-rules.ts`                                                                                                                                                 | Who may do what, the allowed status moves, approval gates, delete blockers, idempotency helpers. |
| `document-actions.ts`                                                                                                                                               | What the UI offers to a person in a given state (button on or off, and why).                     |
| `search-rules.ts`, `review-rules.ts`, `review-flow-rules.ts`, `upload-rules.ts`, `tenant-rules.ts`, `rate-limit-rules.ts`, `event-delivery-rules.ts`, `ip-rules.ts` | One area each.                                                                                   |

Ways a document is changed (each applies the pure rules):

| File                                                                   | Entry                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document-*.functions.ts` (`document-write.functions.ts` lists them)   | Screens (one document at a time), through `runWrite` in `seam-runtime.ts`. Reads: `document-read`; details and versions: `document-content`; status, hold, delete: `document-status`; review: `document-review`; access: `document-access`. |
| `tmf-gateway.ts` (lists the `gateway-*.ts` files) + `tmf667-mapper.ts` | The public TMF API used by other systems, pinned to the tenant of the system key. Start at `gateway-core.ts`.                                                                                                                               |
| `bulk-worker.ts` (+ `search.functions.ts` to start a job)              | Many documents at once, in batches.                                                                                                                                                                                                         |

Helpers, and when to use each:

| Need                                                           | Use                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A database query whose failure must stop the work              | `must()` in `shared/must.ts`. It throws `DatabaseError`; the entry point turns that into "unavailable".              |
| Update one document and fail loudly                            | `updateDocument` in `document-update.ts`.                                                                            |
| Update one document only if it still looks the way you read it | `updateDocumentIf` in `document-update.ts`.                                                                          |
| Place or release a legal hold                                  | `holdColumns` in `document-update.ts`.                                                                               |
| Delete a document                                              | `deleteIfAllowed` in `document-delete.ts` (hold, retention date and master floor, then a guarded write).             |
| The master tenant's minimum retention                          | `masterRetentionFloor` in `retention-floor.ts`.                                                                      |
| Store the first version of a document the API registered       | `storeFirstVersion` in `gateway-document-store.ts`.                                                                  |
| Expiry and cleanup of old keys and tokens                      | `runMaintenance` in `maintenance.ts`, called by `runScheduled` in `scheduled-run.ts`. Never from a person's request. |

Three ways to use `must()`, depending on the edge: let it throw inside `runWrite` (screens); catch `DatabaseError` and answer 503 (the API, see `runOrUnavailable` in `gateway-idempotency.ts`); catch it and return a result (`storeFirstVersion`, `deleteIfAllowed`).

## Main flow

A change from a screen: server function, then `runWrite` (who is the caller, may they touch this document, is this a repeated request), then the handler: read, apply the pure rules, write, record the activity event. A change from the API follows the same steps with a system key instead of a person. Bulk changes re-check every document with the rules of a single change.

Background work: the scheduler calls `src/routes/api/public/jobs/bulk-documents.ts`, which runs `runScheduled`.

## Rules that must not break

- Every write is pinned to the caller's tenant. Seeing a document never lets you change it.
- A change is not reported as done unless its activity event was written (`audit` fails closed).
- A write that follows a check must not override a change made in between (use `updateDocumentIf`).
- Approval keeps four-eyes: the person who added a document cannot approve it on a screen or in a bulk change.
- Nothing from the database (messages, ids of other tenants) reaches an answer or a log line.
- A file in this folder stays under 300 lines. Files above the limit are listed in `src/test/repo-hygiene.test.ts` and may not grow: put new code in a new file next to them.

## How to test

Run `bun run check` (lint, types, tests, build). Tests that need no database use the in-memory `FakeDb` in `src/test/fake-db.ts`; the TMF API tests build a whole world with `src/test/gateway-world.ts`. The checks that need the real backend run with `RUN_ACCESS_TESTS=1`.

## Common mistakes

- Reading `data` and ignoring `error`: the Supabase client never throws, so a failed query looks like "no rows". Wrap it in `must()`.
- Deciding from one read and writing without a condition: use `updateDocumentIf`.
- Adding code to `tmf667-mapper.ts` or another file over the size limit instead of a new file.
- Doing housekeeping inside a request: it belongs in `maintenance.ts`.
- Putting a rule in a handler: rules are pure functions in a `*-rules.ts` file, so every entry point gives the same answer.
