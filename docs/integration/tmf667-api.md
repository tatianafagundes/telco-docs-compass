# TMF667 API: guide for connecting a system

For the team that connects an order care, ticketing, CRM or CPQ system to Telco Docs Compass. The formal contract is `contracts/seams/tmf667-document.openapi.yaml`; this guide explains how to use it. How the API is built inside the app is in `docs/architecture/ARCHITECTURE.md` and `src/routes/api/public/tmf-api/AGENTS.md`.

The API follows TM Forum TMF667 Document Management v4 and the TMF630 REST guidelines. Conformance is not claimed: the official test kit has not been run. How it compares with the official definition, field by field: `docs/integration/tmf667-conformance.md`.

## Before you start

1. A tenant admin of the organisation opens Admin, Connected systems, and connects your system. They choose its kind and its scopes (what it may do) and can set its own rate limits.
2. The system key (`erad_...`) is shown once. Store it in your secret store. It expires after 12 months. Rotating or revoking it ends all its tokens at once.
3. A key belongs to one organisation (tenant). It sees and changes that organisation's documents only; anything else answers 404.

| Scope | Allows |
| --- | --- |
| `read` | list and read documents, document types, download links |
| `register` | register documents and change them (PATCH) |
| `transition` | move along the status path, except approval |
| `approve` | approve (four-eyes and required details still apply) |
| `hold` | place and release legal holds |
| `delete` | delete (soft; an admin can restore) |
| `subscribe` | subscribe to change events |
| `scan` | the organisation's own antivirus: download files waiting for its scan and report the result |
| `extract` | the organisation's own reader: download files waiting to be read and propose their details |

`scan` and `extract` are exclusive: a key with one has no other scope, and an organisation has one such key of each kind until it is disconnected. Such a key is checked again on every call; a key that is not the organisation's connected system for it answers 403 `notDesignated`.

A call without the scope it needs answers 403 `scopeMissing`.

## Addresses

Base path: `/api/public/tmf-api/document/v4` on the app's host. The older `/api/public/tmf-api/documentManagement/v4` answers the same, with `Deprecation`, `Sunset` (10 May 2027) and `Link: successor-version` headers; move off it.

| Method and path | Does | Scope |
| --- | --- | --- |
| `GET /document` | list, with filters `status`, `lifecycleState`, `documentType`, `relatedEntity.id`, `relatedEntity.@referredType`, `externalIdentifier.id`, `fields`, `offset`, `limit` (max 100) | `read` |
| `POST /document` | register a document with one attachment | `register` |
| `GET /document/{id}` | read one | `read` |
| `PATCH /document/{id}` | change name, description, details, links (added, never removed), external ids, end date, or the status (`application/merge-patch+json` or `application/json`) | `register` for fields; a status-only change needs `transition` or `approve` instead |
| `DELETE /document/{id}` | soft delete; holds and keep-until dates block it | `delete` |
| `POST /document/{id}/transition` | extension: move to a `lifecycleState` | `transition` or `approve` |
| `POST /document/{id}/legalHold` | extension: `{ "active": true, "reason": "...", "reference": "..." }` | `hold` |
| `GET /document/{id}/attachment/{attachmentId}/content` | extension: a download link valid for 60 seconds (current version, once checked) | `read`, or `scan`/`extract` during the system's own step |
| `POST /document/{id}/attachment/{attachmentId}/uploaded` | extension: confirm the file sent to `uploadUrl` | `register` (the system that registered it) |
| `POST /document/{id}/attachment/{attachmentId}/scanResult` | extension: the antivirus's result | `scan` |
| `POST /document/{id}/attachment/{attachmentId}/extractionResult` | extension: the reader's result and proposed details | `extract` |
| `GET /documentSpecification`, `GET /documentSpecification/{id}` | the document types the organisation accepts | `read` |
| `POST /hub`, `DELETE /hub/{id}` | subscribe to events, unsubscribe | `subscribe` |
| `POST /api/public/tmf-api/oauth/token` | exchange the key for a 15-minute token | none |

Lists return `X-Total-Count` and `X-Result-Count`. `externalIdentifier.owner` is also a filter; `status` and `lifecycleState` together must both match. A `relatedEntity.id` or `relatedEntity.@referredType` filter that matches more than 1000 record links answers 400 `filterTooBroad`: narrow it.

## Authenticating

Send the key, or better a short-lived token, as `Authorization: Bearer ...`. Getting a token (OAuth 2.0 client credentials; form or JSON body, or the key as the HTTP Basic password):

```sh
curl -s -X POST "$BASE/api/public/tmf-api/oauth/token" \
  -d grant_type=client_credentials \
  -d client_secret="$SYSTEM_KEY"
# {"access_token":"eradt_...","token_type":"Bearer","expires_in":900,"scope":"read register ..."}
```

Errors from this endpoint are OAuth shaped (`{ "error": "invalid_client", "error_description": "..." }`): `invalid_client` (401), `unsupported_grant_type` or `invalid_request` (400), `temporarily_unavailable` (429, with `Retry-After`). Reuse a token until it expires. A system may hold 10 live tokens; token requests are also limited per caller address and per system (429 when exceeded).

## Making changes safely

Every change to a document (`POST /document`, `PATCH`, `DELETE`, `/transition`, `/legalHold`) needs an `Idempotency-Key` header (`/hub` does not): 8 to 128 letters, digits, `-` or `_`, new for each intended change and reused only to retry that same change.

| You send | You get |
| --- | --- |
| a new key | the change runs |
| the same key and body again, after a success | the stored answer of the first request, with `Idempotent-Replay: true`; nothing runs twice |
| the same key and body again, after a refusal or error | the request runs again (only successes are stored) |
| the same key while the first is still running | 409 `idempotencyInProgress`: wait and send again |
| the same key with another body | 409 `idempotencyMismatch` |
| no key | 400 `idempotencyKeyMissing` |

Every answer carries `X-Request-ID`; quote it when you report a problem.

## Registering a document

```json
POST /document
{
  "name": "Order form O-7731",
  "documentType": "contract",
  "relatedEntity": [{ "id": "O-7731", "role": "subject", "@referredType": "ProductOrder" }],
  "attachment": [{ "mimeType": "application/pdf", "name": "order.pdf", "contentHash": "<sha256 hex>" }]
}
```

The attachment is one of three forms:

- `contentHash` only: the answer (201) includes `uploadUrl`, a signed Supabase Storage upload address. Upload the file there, then confirm it with `POST /document/{id}/attachment/{attachmentId}/uploaded` (an `Idempotency-Key`, no body). The app reads the stored file, compares its size and hash with what you declared, and starts the checks. Refusals: 409 `fileMissing` (not uploaded yet), `hashMismatch`, `sizeMismatch`, `notUploading` (already confirmed), 413 `tooLarge` (over 25 MB), 403 `notRegisteredHere` (another system registered it). An upload never confirmed fails after 24 hours.
- `url`: a public `https` address the app fetches once (max 25 MB, no redirects, no private addresses).
- `content`: the file as base64 inline (max 5 MB of file).

Whatever the form, the file is checked before anyone can download it: it starts as uploading, goes through the scan and the reading, and only then is ready. The answer of `POST /document` gives the state it reached.
`documentType` must be one the organisation accepts (`GET /documentSpecification`), and the file type must be one the type allows. Records named in `relatedEntity` must exist in the organisation (1 to 5 links). The document starts as `created` (`lifecycleState: draft`).

## Status and the review rules

| TMF `status` | Our `lifecycleState` |
| --- | --- |
| `created` | `draft` |
| `reviewed` | `in_review` |
| `approved` | `approved` |
| `published` | `effective` |
| `archived` | `superseded`, `expired`, `archived` |
| `deleted` | deleted |

- The path only moves forward: `draft`, `in_review`, `approved`, `effective`, then `superseded` or `expired`, then `archived`.
- Approval needs every required detail confirmed by a person in the app. A system cannot approve a document it registered itself (409 `fourEyesRequired`); another system or a person can.
- After approval the confirmed details, dates and files are locked (409 `approvedContentLocked`); name, description, sensitivity, external ids and links stay editable.
- A legal hold or a keep-until date blocks deletion (409 `legalHold` or `retention`).

## Events

Subscribe with a public `https` callback and an optional filter:

```json
POST /hub
{ "callback": "https://receiver.example/tmf-events", "query": "eventType=DocumentChangeEvent&status=published&documentType=contract" }
```

The answer includes `signingSecret` once; store it. Events: `DocumentCreateEvent`, `DocumentChangeEvent`, `DocumentDeleteEvent`, and `DocumentBatchEvent` (one per bulk change pass, only for subscriptions that name it). Only events after the subscription was created are sent.

An event carries references, never document content: fetch the document with your key. A status change carries `id`, `href`, `status` and `lifecycleState`; a delete carries `status: deleted`; other changes carry `id`, `href` and `changedAttributes` (a legal hold change names `legalHold`, without its value); a batch event carries a list of references. File events (`DocumentFileStoredEvent`, `DocumentFileReadyToReadEvent`, `DocumentFilePurgedEvent`, declared extensions) are sent only to subscriptions that name them, and carry `event.file`: `versionId`, `contentHash`, `sizeBytes`, `mediaType` and `attempt` for Stored; `versionId` and `attempt` for ReadyToRead; `versionIds` for Purged. The organisation's own antivirus and reader answer through the API (next section). Each delivery has these headers:

| Header | Use |
| --- | --- |
| `X-Signature` | `sha256=<hex HMAC-SHA256 of "<X-Signature-Timestamp>.<raw body>" with the signing secret>` |
| `X-Signature-Timestamp` | Unix seconds. Reject events older than 5 minutes |
| `X-Event-Id` | the same across retries. Ignore an id you already processed |
| `X-Delivery-Attempt` | the try number |

Checking a delivery (Node):

```js
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(rawBody, headers, secret) {
  const ts = headers["x-signature-timestamp"] ?? "";
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = Buffer.from(
    "sha256=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex"),
  );
  const got = Buffer.from(headers["x-signature"] ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
```

The callback must answer directly: redirects are not followed, a delivery times out after 5 seconds, and the address is checked again (public, https) before every delivery. Revoking the system key removes its subscriptions. Answer any 2xx quickly. Otherwise the delivery is retried for your subscription only, after 30 s, 2 min, 10 min, 30 min and 2 h (a longer `Retry-After` is honoured up to 1 h), and given up after 6 attempts. Delivery is at least once.

## The organisation's own antivirus and reader
An organisation can check files with its own antivirus and read them with its own reader instead of the built-in ones. The organisation administrator connects the system with the `scan` or `extract` scope (one of each kind per organisation, no other scope on that key) and turns the step on in Connected systems. A step that starts then waits for that system: subscribe to `DocumentFileStoredEvent` (scan) or `DocumentFileReadyToReadEvent` (read). Without an answer the step fails after 30 minutes; a person can try again.
1. On the event, download the version with your key: `GET /document/{id}/attachment/{versionId}/content`. This works only for the current version, only during your own step (409 `notYourStep` otherwise), never for a quarantined version.
2. Hash the bytes you downloaded (SHA-256, lowercase hex; `sha256:` in front is accepted) and check them. Never send the hash from the event without hashing the file yourself.
3. Answer once, with an `Idempotency-Key` and the `attempt` from the event:
```json
POST /document/{id}/attachment/{versionId}/scanResult
{ "result": "clean", "contentHash": "<sha256 hex of the bytes>", "attempt": 1, "engine": "ClamAV 1.3" }
```
`result` is `clean`, `infected` (with `threatName`, shown only in the activity log) or `error`. `engine` and `threatName` are up to 64 letters, digits, spaces and `._:/-`. `clean` is accepted only after your key downloaded this version in this attempt (409 `notFetched`).
```json
POST /document/{id}/attachment/{versionId}/extractionResult
{ "result": "read", "attempt": 2, "fields": [{ "name": "amount", "value": "48000", "confidence": 0.93, "source": "page 2: table 1" }] }
```
`result` is `read` (with `fields`, possibly empty) or `unreadable`. Field names are the document type's details exactly; a value is one string, number or boolean of the detail's type; at most 100 fields and 1 000 000 bytes. One bad field refuses the whole answer (400 `unknownFields`, `duplicateFields` or `badValues`, with `names`). Details are proposals: a person confirms each one, and a detail a person already filled is kept (listed in `skipped`).
The answer is `{ "id", "versionId", "state", "attempt" }` (plus `proposed` and `skipped` for a reading). The same result again for the same attempt, also under a new key after a lost reply, is answered with `"replayed": true`. Refusals change nothing: 403 `notDesignated` (the key is not the organisation's system for this step), 404 `notFound`, 409 `versionNotCurrent`, `notScanning` or `notReading`, `staleAttempt`, `notYourStep`, `hashMismatch`, `notFetched`, `quarantined`, `changedMeanwhile` (read the document again), `cannotProcess`.
Residual risk: a clean answer is trusted. The app checks that your system downloaded the very file and hashed it, not how well it scanned. A download link already given stays valid for its 60 seconds even if the version is quarantined meanwhile.
## Limits and errors

- Each system has its own allowance per minute (default 120 reads and 30 changes). Over it: 429 `tooManyRequests` with `Retry-After` and `RateLimit-*` headers. One system never uses up another's allowance.
- Bodies over the limit answer 413 `bodyTooLarge` (about 50 KB for ordinary bodies). All limits: `docs/architecture/limits.md`.
- Errors are TMF630 bodies: `{ "code": "...", "reason": "...", "message": "...", "status": "409", "@type": "Error" }`. Act on `code`; `message` is for people.

| Status | `code` | What to do |
| --- | --- | --- |
| 400 | `invalidBody` (also any list over 100 items or nesting over 32 levels), `invalidJson`, `invalidQuery`, `invalidStatus`, `invalidContent`, `invalidCallback`, `unknownDocumentType`, `mimeNotAccepted`, `filterTooBroad`, `idempotencyKeyMissing`, `tooLarge`; reader answers: `unknownFields`, `duplicateFields`, `badValues` (with `names`) | fix the request |
| 401 | `unauthorized` | get a new token; check the key is not revoked or expired |
| 403 | `scopeMissing`, `notDesignated`, `notRegisteredHere` | ask the tenant admin for the scope, or use the key of the system the step waits for |
| 404 | `notFound`, `relatedEntityNotFound` | the document or record does not exist in your organisation |
| 405 | `methodNotAllowed` | use a method the path supports |
| 409 | `transitionNotAllowed`, `fileMissing` (send the content first: sending for approval, approving and making effective need a checked file), `requiredDetailsPending`, `fourEyesRequired`, `approvedContentLocked`, `contentLocked`, `notCurrent` (only the current version is downloaded), `frozen`, `legalHold`, `retention`, `idempotencyInProgress`, `idempotencyMismatch`; file results and confirmations: `versionNotCurrent`, `notScanning`, `notReading`, `staleAttempt`, `notYourStep`, `hashMismatch` (the hash you sent is not the stored file's), `notFetched`, `quarantined`, `changedMeanwhile`, `cannotProcess`, `notUploading`, `sizeMismatch` | the document's state refuses it; read the message, do not retry blindly (except `idempotencyInProgress`) |
| 413 | `bodyTooLarge`, `tooLarge` | send the file by `url` or `uploadUrl` |
| 415 | `unsupportedMediaType` | PATCH needs `application/merge-patch+json` |
| 422 | `attachmentUnreachable`, `hashMismatch` | registration: the file at `url` could not be fetched, or does not match `contentHash` (a file result's hash mismatch is 409) |
| 429 | `tooManyRequests` | wait for `Retry-After` |
| 503 | `unavailable` | retry with the same `Idempotency-Key` |

## Testing a connection

`e2e/tmf-api.py`, `e2e/tmf-events.py` and `e2e/tmf-rate-isolation.py` exercise the whole API against a running app (`BASE_URL=<address> python3 e2e/tmf-api.py`). They create "TMF test" data; see `docs/operations/regression-after-publish.md`.
