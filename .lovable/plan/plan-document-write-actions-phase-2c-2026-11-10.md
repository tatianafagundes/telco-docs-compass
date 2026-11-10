# Plan: document write actions (Phase 2c)

English only, no new libraries. Role assignment and access tests stay pending until you confirm the 5 demo accounts exist.

## What gets built
All remaining operations from your OpenAPI file, as signed-in server actions:
register, updateMetadata, addVersion, getContentUrl, transition, setHold, delete, restoreDeleted, reportProblem, grantAccess, revokeAccess, listAccess, reviewExtraction. `find` is upgraded with exact-number match first, then text match, and pagination with a visible-only total.

## Rules enforced on the server (from prompt 02, step D)
- Tenant always comes from the caller's role, never from the request.
- Every write first confirms, as the caller, that the document is visible; only then writes with elevated rights.
- Every write needs an idempotency key: same key + same body replays the stored answer; same key + different body returns a conflict. Keys older than 24 hours are purged.
- Status path: draft → in review → approved → effective → superseded or expired → archived. In review → draft only through "Send back" (reportProblem). Approve is refused while any required detail is not confirmed.
- Versions are never edited; restoring a version adds a new one. No edits on superseded, expired or archived documents.
- Delete is soft only; legal hold or retention blocks it with a plain reason ("Delete unavailable: legal hold DSP-2026-031"). Master hard floors (minimum retention) are respected.
- File access is refused while a file is scanning or quarantined. Seeded documents use their sample pages; real uploads get short-lived links (5 min preview, 1 min download), stored under tenant/version, never the file name.
- Errors use the contract's error shape (code, category, retryable, customer message key); no database text reaches the screen. Logs hold only operation, tenant, document, status and duration.
- Each action writes its own audit entry (upload, statusChange, restore, hold, delete, share, accessDenied), with no personal data.

## Who can do what (assumption, change if you like)
| Action | Allowed roles |
|---|---|
| Add document, add version, edit details | contributor, reviewer, manager, tenant admin |
| Confirm AI-read details, approve, send back | reviewer, manager, tenant admin |
| Make effective, set or lift hold, share or revoke | manager, tenant admin |
| Delete and restore | manager, tenant admin (never on hold) |
| Viewer | read, view, download only |

## The single connection file
`src/services/api.ts` becomes the only door the screens use: one typed function per operation, it creates the idempotency key (`<uuid>:document.<op>`) and turns server errors into a typed error with the customer message key.

## Tests (run now, no accounts needed)
- Allowed and refused status changes, including "send back" only via reportProblem.
- Approve refused while a required detail is pending.
- Delete refused under legal hold and under retention.
- File link refused while scanning or quarantined.
- Same idempotency key with a different body is a conflict; with the same body it replays.
- Only view and download can be recorded by the client.

## Still pending after this step
- Role assignment for the demo accounts, removal of the setup helper, and the access checks from prompt 02 (blocked on your confirmation).
- Pipeline simulation (uploading → scanning → reading → ready) arrives with the upload screen in phase 5.

## Technical notes
- Pure rule logic lives in `src/services/document-rules.ts` (no database), so tests cover it directly; server functions call it.
- Zod schemas for inputs go in `src/schemas/document.ts`, derived from your JSON schemas.
- Signed upload links come from the private file bucket via the server; the browser never touches storage directly.
