# Requirements (EARS style), grouped by phase

Each requirement references BR ids in `docs/rebuild/03-business-rules.md`. Acceptance = the listed tests pass (`16-traceability.csv`).

## P1 Foundation and identity
- R1.1 WHEN a person signs in through Keycloak THE SYSTEM SHALL resolve exactly one tenant and one role and refuse access if the token and the stored role disagree (BR-003).
- R1.2 THE SYSTEM SHALL provide the ERAD design tokens and components with light and dark themes (13).
- R1.3 WHEN a person has no role THE SYSTEM SHALL show "No access assigned. Ask an administrator."

## P2 Documents core
- R2.1 THE SYSTEM SHALL let contributors add documents to records with type, size and duplicate checks (BR-063–069), and run the pipeline (BR-062).
- R2.2 THE SYSTEM SHALL keep immutable versions with a content hash and give 300 s preview and 60 s download links, blocked while content is locked (BR-060–061).
- R2.3 THE SYSTEM SHALL enforce the status path and role capabilities (BR-010–016) with optimistic LWT.
- R2.4 THE SYSTEM SHALL soft-delete and restore documents, subject to the blockers (BR-050–054).
- R2.5 THE SYSTEM SHALL write an audit event for every operation (BR-095).
- R2.6 THE SYSTEM SHALL enforce visibility (BR-090) on every read, including sharing and cross-tenant grants (BR-091–094).

## P3 Details and approval
- R3.1 THE SYSTEM SHALL present the guided check-details page (05-screens/review.md) with ordering, checks and reasons (BR-030–043).
- R3.2 WHEN required details are pending, or the approver added the document, THE SYSTEM SHALL refuse approval with the exact reason (BR-020–022).

## P4 Holds and retention
- R4.1 THE SYSTEM SHALL support legal holds, effective retention with group floors, deletion history and permanent deletion with a tombstone (BR-050–056).
- R4.2 THE SYSTEM SHALL support group and country configuration with lock, extend and override (BR-080–087).

## P5 Search
- R5.1 THE SYSTEM SHALL search millions of documents with filters, keyset paging, capped counts and facets in OpenSearch under the access filter (BR-100–104).
- R5.2 THE SYSTEM SHALL run bulk jobs of up to 10,000 documents with a per-document re-check, skip reasons and audit (BR-105–108).

## P6 TMF667 API
- R6.1 THE SYSTEM SHALL expose TMF667 v4 at `/api/public/tmf-api/document/v4`, plus the legacy alias until 10 May 2027 (06-api/tmf667.md, BR-130–139).
- R6.2 THE SYSTEM SHALL authenticate systems with Keycloak client credentials, enforce scopes, and pin every query to the system's tenant.
- R6.3 THE SYSTEM SHALL apply per-system read and change limits with 429, Retry-After and RateLimit headers (BR-110–115).

## P7 Events and connected systems
- R7.1 THE SYSTEM SHALL emit TMF688-style events through an outbox, delivered per subscriber, signed, with retries and no duplicates (BR-120–127).
- R7.2 THE SYSTEM SHALL let tenant admins connect, rotate, revoke and limit systems (07).
