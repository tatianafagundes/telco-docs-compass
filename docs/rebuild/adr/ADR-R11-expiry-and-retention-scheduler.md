# ADR-R11: Expiry and retention need a scheduled path; the oracle expires on read

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** `docs/decisions/2026-11-10-expiry-without-scheduler.md:1-2`, `02-domain-model.md:78`, BR-013, BR-050 to BR-055 (`03-business-rules.md:21,59-64`), `10-data-mapping-cassandra.md` (no table by expiry), `11-opensearch-index.md:62`, `14-non-functional.md:44-47`, `00-README.md:34` (glossary: legal hold blocks expiry), invariant 8

## Context
The prototype has no scheduler: on every `find` it runs a tenant-wide `UPDATE documents SET status='expired' WHERE expiry_date < today AND status IN (approved, effective)` and writes one audit row per document (`retention.functions.ts:211-223`, called at `document-write.functions.ts:84-85`). The rebuild pack maps every query to a table (`10:7-30`) but has none keyed by `expiry_date` or `retain_until`, and `09`/`07` introduce scheduled workers only for events and bulk.

## Problem at scale
- Cassandra has no `UPDATE ... WHERE expiry_date < today`; the oracle's statement cannot be ported. Without a path, documents in the rebuild never reach `expired`, so BR-013 (frozen), the status facet, "Expiring soon" vs "Expired" and retention after expiry are all wrong.
- Running the oracle's behaviour on read would mean a scan on every list call: at 5M documents per tenant and hundreds of tenants, an index query per list is affordable, but the transitions themselves must go through the command (LWT, audit, outbox, event) and cannot run inside a read.
- A day with 100k documents expiring in one tenant (contracts with a common end date) is 100k transitions, 100k audit rows, 100k outbox rows: a bulk job in disguise, needing the same claim, batch and resume semantics as ADR-R04.
- The oracle expires documents under legal hold (`retention.functions.ts:213-217` filters on status and `deleted_at` only). The glossary (`00:34`) says a hold "blocks deletion and expiry". Oracle and pack disagree; the rebuild cannot satisfy both.
- Retention: `retain_until` and the group floor (BR-050, BR-055) are evaluated at delete time only; nothing lists documents whose retention has ended (an admin "eligible for permanent deletion" list has no query).

## Options
**A. Query-first due tables, scheduled job per tenant.** `documents_by_expiry ((tenant_id, expiry_day), id)` and `documents_by_retain_until ((tenant_id, retain_day), id)`, maintained by the projection consumer (ADR-R08). A leader-elected job walks the due partitions per tenant and applies `transition(expired)` per document through the normal command with `IF status=:from AND expiry_date=:seen`, so a document changed since is skipped. Progress and resume as in ADR-R04.
Trade-off: two more projection tables; a job per tenant per day-partition; the transition lags the date by the job period.

**B. Index-driven job.** Query OpenSearch for `status in (approved, effective) AND expiry_date < today` with PIT + `search_after`, apply the same command per hit.
Trade-off: depends on a derived index being current (ADR-01 says it is rebuildable, not authoritative); same LWT guard protects correctness.

**C. Computed status on read.** Keep stored status, show "expired" when `expiry_date < today` and status is approved/effective; transition lazily on the next write.
Trade-off: facets and counts from the index disagree with the screen; BR-013 freezing must also be computed; audit row appears only on the lazy write.

## Recommendation (not a decision)
A for expiry (the hold question decided by the owner: the recommendation is to honour the glossary and skip documents under hold, recording a "held past expiry" audit row), and A's second table for a retention-eligible list without automatic purge (BR-052 keeps purge admin-only). The decision record `2026-11-10-expiry-without-scheduler.md` should be marked prototype-only.

## Consequences for the rebuild
- Two projection tables and one scheduled job with lease, batch and resume; the single-document transition command is reused (same as bulk).
- A system actor for audit rows ("Expired on its expiry date") and a per-document outbox row, so subscribers get `DocumentStateChangeEvent` for expiry (the oracle's trigger does this today).
- A parity test for the hold-vs-expiry decision, whichever way it goes.

## What the prototype oracle currently does
- `expireDue` runs an admin-client UPDATE on every list (`src/services/retention.functions.ts:211-223`); the trigger emits a state-change event per expired document; legal hold is not checked.
