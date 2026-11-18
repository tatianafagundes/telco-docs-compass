# Runbook

Generic steps for running and checking the app. It names no project, address or secret: look those up in your own environment. Keep the list of risks and their owners in your internal wiki, not here.

## The scheduled job

One scheduler call, every minute, runs two things: advances bulk changes, then does the housekeeping (see `docs/architecture/ARCHITECTURE.md`, "Housekeeping"). Its answer is JSON; the status is 200 when everything worked and 500 when any part failed.

| Field | Meaning | Look at it when |
|---|---|---|
| `ok` | false if bulk changes or any housekeeping step failed | the scheduler shows 500 |
| `processed` | bulk jobs it worked on | jobs seem stuck while this stays 0 |
| `bulkFailed` | the bulk pass threw | true |
| `expiredDocuments` | documents expired in this run (at most 500 per run) | it stays at 500 run after run: a backlog is clearing |
| `deadLetters` | deliveries to other systems that were given up on | above 0 |
| `failed` | names of housekeeping steps that failed | not empty |

### If the job fails or stops

1. Read the last answer and the application log for the same minute. Log lines are JSON with an `op` field (`scheduled.bulk`, `maintenance`, `bulk.fail`, `idempotency.complete`) and a step or reason code. They never contain document names, reasons or database text.
2. If the answer is 401 or 500 before any field appears, check the scheduler's secret and the app's copy of it match (rotate both together).
3. If nothing calls the job at all: bulk changes stop moving, documents expire only when someone opens a list (once a minute per tenant) and old keys and tokens are not cleaned. Restore the scheduler first; the next run catches up (expiry runs in batches of 500).
4. A claim left by a worker that died is taken over by itself after 5 minutes, and a bulk job whose worker stopped is failed after its lease (10 minutes). Nothing needs clearing by hand.

## A bulk job shows "failed"

The log line `bulk.fail` carries the job id, tenant, action, how far it got and a reason:

| Reason | What happened | What to do |
|---|---|---|
| `creatorLostRole` | the person who started it no longer has a role in the tenant | start it again as someone who does |
| `leaseExpired` | the worker stopped mid-batch | start it again; documents already changed are skipped as "unchanged" |
| `batchError` | a database error during a batch (`cause` gives the error type) | check the database, then start it again |
| `countsDoNotAdd` / `corruptedJob` | the job's counts or document list are inconsistent | report it as a defect |

Changes already made stay made and each has its activity entry.

## Events to other systems

Deliveries are retried with backoff and then given up on. A count of given-up deliveries above 0 (`deadLetters`) means a receiver needs attention.

1. Find the receiver: the subscription the delivery belongs to (the delivery row names it).
2. Fix the receiver (address, certificate, availability).
3. Requeue a delivery with `resendDeadLetter` (`src/services/delivery-dead-letter.ts`), giving the tenant, the event id and the subscription id. It only requeues a delivery that was given up on. The next scheduled delivery pass sends it.
4. Receivers must deduplicate by the event id header, because delivery is at least once.

## Connected systems

- A system key is shown once when created or rotated. Rotating or revoking it removes its access tokens at once.
- A system can hold 10 live access tokens; asking for more answers 429. It should reuse a token until it expires (15 minutes).
- If a key leaked: revoke it, then connect the system again to get a new one.

## Running the tests

- `bun run check`: lint, types, tests and build. This is the gate before every commit.
- `RUN_ACCESS_TESTS=1 bun run test`: also runs the tests that need the real backend (row-level security and the database functions). They need the connected backend's environment variables and its demo accounts. Run this after changing anything about access, tenants or the database functions.
- Tests that use the in-memory database prove the application's own checks only; the database's own rules are covered by the opt-in run.

## Before a release

- Walk the main flows with the keyboard only and with a screen reader at 200% zoom (see `docs/architecture/accessibility.md`).
- Run an axe-core scan of the main screens, including hovered rows and open dialogs.
- Update dependencies inside their ranges and check the advisories; apply the fix versions that exist.
