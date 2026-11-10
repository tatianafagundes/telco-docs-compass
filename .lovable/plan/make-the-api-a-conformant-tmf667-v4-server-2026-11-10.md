# Make the API a conformant TMF667 v4 server

The audit compared our API with the official TMF667 v4.0.0 specification. The API is a well-secured custom profile, but a standard TMF667 client would fail on six points. These fixes keep today's systems working while adding the standard behaviour.

## Phase 1: Standard client compatibility (high)
1. **Standard address.** Serve the API at `/tmf-api/document/v4`. The current `/documentManagement/v4` address keeps working as an alias for 6 months and returns a `Deprecation` header.
2. **Standard status.** Return `status` with TMF values. Our own detailed state stays alongside it as `lifecycleState`.
   - draft → created
   - in_review → reviewed
   - approved → approved
   - effective → published
   - superseded, expired, archived → archived
   - deleted → deleted

   Filtering accepts `status=` as well as `lifecycleState=`.
3. **Standard registration.** `POST /document` accepts `attachment` as an array, following TMF.
   - **Just the file details:** the reply includes an upload address, as today.
   - **A link (`url`):** the file is fetched once and checked.
   - **Small files sent inline:** base64 `content` up to 5 MB.

   The old single-object form still works.
4. **Standard changes (`PATCH`).** Accepts `application/merge-patch+json`.
   - **Editable:** name, description, characteristic, externalIdentifier and relatedEntity (add only).
   - **Status:** setting `status` runs the same path rules and approval check as `/transition`. Anything not allowed returns 409 with the reason.
5. **Delete (`DELETE /document/{id}`).** Works like delete in the app: the document is removed from its record, and holds and keep-until dates still block it. Needs a new `delete` permission.
6. **Standard event names.** Send DocumentCreateEvent, DocumentChangeEvent (status and detail changes, with `changedAttributes`) and DocumentDeleteEvent. Add correlationId, domain, title, priority and timeOcurred. Old names remain available for 6 months to subscriptions that ask for them.

## Phase 2: Data model and interoperability (medium)
- **Our extra fields get a declared home.** Documents are typed `@type: "EradDocument"` with `@baseType: "Document"` and an `@schemaLocation` to a published schema. That schema covers sensitivity, legalHold, validFor, lifecycleState, contentHash and isCurrent.
- **Attachments carry `url`,** pointing to the 60-second download address, plus `attachmentType` (the document type).
- **Optional standard fields are added:**
  - `externalIdentifier`, such as a CPQ quote or order number, also searchable.
  - `relatedParty`: the owning organisation.
  - `document` references, linking earlier versions or superseded documents.
- **Standard record type names:** `Account` becomes `BillingAccount` in replies and filters, with the old name still accepted.
- **Document type fields:** the custom fields (accepted file types, maximum size) move into `specCharacteristic`, and `validFor` is added.
- **Event filters:** subscriptions can also filter by `status` and `documentType`.
- **A conformance profile page in the contract** lists:
  - each standard operation we support;
  - the optional parts we leave out (creating or changing document types through the API — admins do that in the app);
  - every extension, with the reason for it.

## Phase 3: Security hardening
- **Request limits.** Each key gets limits: 120 reads and 30 changes per minute. Going over returns 429 with `Retry-After` and is shown in Connected systems.
- **Signed events can't be replayed.** Each event carries an `X-Signature-Timestamp`, and the signature covers both the timestamp and the body. Receivers reject events more than 5 minutes old.
- **Safer notification addresses.** Each address is checked when it is set up and again before every delivery. Delivery is blocked if the address points to a private network.
- **Key expiry.** Keys get an optional expiry date (default 12 months), and admins see a reminder 30 days before.
- **Optional OAuth 2.0 client credentials (TMF630 recommendation).** Systems swap their key for a token that lasts 15 minutes and is limited to the same permissions. Plain keys keep working.

## Checks
- `e2e/tmf-api.py` gains a "standard client" section. It calls only standard operations at the standard address and checks:
  - replies against the official TMF667 v4 schema;
  - status mapping, PATCH status, DELETE and the new event names;
  - 429 replies and replay rejection.
- Mapper unit tests cover each status mapping and both registration forms.
- The existing 73 checks keep passing on the old address.

## Decisions for you
- How long the old address and event names stay (6 months proposed).
- Whether OAuth is needed now or can wait for the first system that needs it.

## Technical details
- New routes live under `src/routes/api/public/tmf-api/document/v4/`, re-exporting the existing handlers. The old folder adds a `Deprecation`/`Link` header in `reply()`.
- Status mapping, merge-patch parsing and the event envelope go into `tmf667-mapper.ts` as pure functions with tests. `patchDocument` sends `status` through the transition logic.
- The `documents` trigger keeps writing internal event kinds. The mapper translates them to v4 names at delivery time, according to the subscription's `query`.
- New `delete` scope; a column for key expiry and rate counters (a small `api_rate` table keyed by client and minute).
- `deliverPending` re-resolves the callback host with DNS over HTTPS before each send and skips private addresses.
- OAuth: `POST /tmf-api/oauth/token` (client_credentials) signs a short-lived token with an app secret. `authenticate()` accepts either the key or the token.
