# ADR-R10: Idempotency keys: partition key drops actor and operation; reserve-then-complete

**Status:** Proposed (owner's decision)
**Date:** 2026-11-12
**Reviews:** ADR-03 (`09-target-architecture.md:37`), `10-data-mapping-cassandra.md:23,83-84`, BR-070 to BR-072 (`03-business-rules.md:84-86`), `02-domain-model.md:38`, `14-non-functional.md:7`

## Context
`10:83-84` defines `idempotency_keys ((tenant_id, key))` with a table TTL, written with `INSERT ... IF NOT EXISTS`. The prototype keys on `(tenant_id, actor, key, operation)` (`0000_documents_schema_v0_1_0.sql:346-347`) and uses the client id as actor for the TMF API (`tmf-gateway.ts:152`). Its flow is read, run, insert (`seam-runtime.ts:101-137`).

## Problem at scale
- With 100+ connected systems per operator and several per tenant, two systems in the same tenant sending `Idempotency-Key: order-7731` (a natural key for both) collide under `((tenant_id, key))`: the second system receives the first system's stored response (replay) or a 409 mismatch for a request it never made. The prototype's key includes actor and operation; the Cassandra DDL loses both, so the rebuild contradicts its own oracle and BR-071.
- `INSERT IF NOT EXISTS` after running the operation (as the prototype does) does not stop two concurrent requests with the same key from both executing: both read "no stored key", both run, the second insert fails. For non-idempotent operations (register a document, create a version) that is two documents. To use the LWT as a guard it must run before the operation, which means a row without a response yet.
- A stored `response` is the full reply (`seam-runtime.ts:135`): a document DTO per write, for every write in the TTL horizon; with 100 systems at the write allowance this is a sizeable table whose rows are read once at most.

## Options
**A. Reserve-run-complete with a lease.** `INSERT (tenant_id, actor, operation, key, request_hash, state='inProgress', locked_until) IF NOT EXISTS`. Not applied: read the row; hash differs = `seam.idempotency.mismatch`; `state='done'` = replay; `inProgress` and lease valid = 409 "in progress" with `Retry-After`; lease expired = take over (the first attempt died). On completion `UPDATE ... SET state='done', response=?`. TTL on the table.
Trade-off: two LWT-free writes plus one LWT per write request; a crashed request blocks its key until the lease ends.

**B. Keep read-run-insert (prototype semantics).** Simple; concurrent duplicates execute twice.
Trade-off: duplicates on retry storms, which is what the key is for.

**C. Store a pointer, not the body.** `response` holds `{status, documentId, versionId}` and the replay is re-rendered from current state.
Trade-off: replay may differ from the original reply when the document changed since; BR-071 says "replay the stored response".

## Recommendation (not a decision)
A with the prototype's four-part key and the stored body (BR-071 as written). The owner decides the lease length and whether `inProgress` returns 409 or waits.

## Consequences for the rebuild
- `10:83-84` becomes `((tenant_id, actor, operation, key))` with `state`, `locked_until`, `response`.
- `seam-runtime` port gains the reserve step before `canSee` and the operation; the TMF `idempotent` wrapper (`tmf-gateway.ts:129-152`) uses the same service.
- A parity test: two concurrent identical requests produce one document.

## What the prototype oracle currently does
- Deletes expired keys on every write (`src/services/seam-runtime.ts:97-98`), reads the stored row, runs, then inserts (`:101-137`); the TMF path mirrors it (`src/services/tmf-gateway.ts:129-152`). No concurrency guard.
