# TMF667 conformance review

How the API compares with the official TM Forum TMF667 Document Management v4.0.0 definition, and what we decided about each difference. How to use the API: `docs/integration/tmf667-api.md`.

## How it was checked (2026-11-18)

- Reference: `TMF667_Document_Management_API_v4.0.0_swagger.json` from the public `tmforum-apis/TMF667_Document` repository on GitHub (the full v4.0.0 definition, 53 definitions, including `documentSpecification` and the listener events). It is not copied into this repository.
- Real replies of every read, the hub, two errors and all five event shapes were produced by the gateway code with the test world (`src/test/gateway-world.ts`) and validated against the official definitions with a JSON Schema validator. Fields that the official definitions do not list were reported separately.
- Our own contract (`contracts/seams/tmf667-document.openapi.yaml`) was linted with Redocly CLI 1.34.5 and compared with the same replies.
- Not done: the TM Forum conformance test kit (CTK). Conformance is not claimed until it has been run against a deployed app.

## What was wrong and is fixed

| Finding | Official | Was | Now | Guarded by |
| --- | --- | --- | --- | --- |
| `category` | array of `CategoryRef` (object with `id`) | array of strings | `CategoryRef` with the business process name as `id` and `name` (not a durable reference: renaming the process changes the id) | `tmf667-audit-gaps.test.ts`, `gateway/schema.test.ts`, `e2e/tmf-api.py` |
| `validFor` values | `TimePeriod` date-times | bare dates (`2027-11-01`) | UTC date-times: start of the effective day, end of the expiry day (`T23:59:59Z`, because expiry runs the day after). Input still accepts a date or a date-time | `tmf667-mapper.test.ts`, `gateway/schema.test.ts`, `e2e/tmf-api.py` |
| `DocumentSpecification.lifecycleStatus` | `DocumentSpecificationStatusType` | our values `inDesign`, `active`, `retired` | `created`, `published`, `archived` | `tmf667-audit-gaps.test.ts`, `gateway/schema.test.ts`, `e2e/tmf-api.py` |
| Our OpenAPI | | no `operationId`, untyped replies for legal hold, document types and hub; `category`, `document`, `@type` on refs, `attachment.creationDate` missing | TMF operation names (`listDocument`, `retrieveDocument`...), typed replies, every returned field declared; lint clean apart from a missing licence | Redocly lint (run by hand) |

## Differences we keep, and why

| Difference | Why | Effect on a standard client |
| --- | --- | --- |
| `@type EradDocument` with `lifecycleState`, `validFor`, `sensitivity`, `legalHold`; attachment `contentHash`, `isCurrent`, `creationDate`; `document[].role` | Our lifecycle and controls need them; declared through `@schemaLocation` (`public/tmf-schemas/EradDocument.schema.json`) | None: extra fields, standard ones keep their meaning |
| `POST /document` requires `documentType`, `relatedEntity` and one `attachment` (official: only `name`) | A document always has a type, a record and a file in this product | A bare create answers 400 with what is missing |
| `PATCH` changes only name, description, status, characteristics, external ids, links (added) and the end date | Type, files and owner change through their own rules (new version, admin) | Other fields answer 400 |
| No `PUT /document`, no `POST`/`PATCH`/`DELETE /documentSpecification`, no `DocumentSpecification*` events | Document types are managed in the app so group locks and country rules stay enforced | Those operations answer 405 |
| Extensions `/transition`, `/legalHold`, `/attachment/{id}/content` | Status moves, holds and downloads need their own scope and reason | None: additional paths |
| Extensions `/attachment/{id}/uploaded`, `/scanResult`, `/extractionResult` and scopes `scan`, `extract` | Confirming an upload and letting the organisation's own antivirus and reader answer for a file (file hooks) | None: additional paths and scopes |
| Events `DocumentFileStoredEvent`, `DocumentFileReadyToReadEvent`, `DocumentFilePurgedEvent` with `event.file` | A scanner or reader needs to know a file waits for it; sent only when a subscription names them | None: not sent to existing subscriptions |
| Events carry a reference (`id`, `href`, `status`, `lifecycleState`), not the whole `Document`; `DocumentChangeEvent` adds `changedAttributes` | Events never carry content; the receiver fetches with its own key and scope | Valid against the official payload (no required fields) |
| `DocumentBatchEvent` carries `event.document` as a list (official: one `Document`) | One event per bulk pass instead of one per document | Only sent to subscriptions that name `DocumentBatchEvent` |
| Hub reply adds `signingSecret` (once) and `@type` | Events are signed | None |
| `DocumentSpecification` also returns `acceptedMimeTypes` and `maxSizeMb` | Legacy duplicates of the file rules in `specCharacteristic`, kept until the old address is retired | None |
| Status codes 413, 415, 422, 429, 503 | TMF630 guidance for size, media type, unreadable content, limits and outages | None |

## Open

- `PATCH validFor.endDateTime` keeps the date part as written and ignores a time zone offset (`2027-11-01T23:30:00-05:00` is stored as 1 November). Decide whether to convert to UTC or refuse offsets.

- Run the CTK against the preview and record the result here.
- Decide whether `DocumentBatchEvent` should follow the official one-document payload.
- Add a licence to the OpenAPI `info` once the repository has one.
