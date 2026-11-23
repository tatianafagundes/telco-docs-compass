# File hooks: design (v2)

## Constraints
- No schema change by us (`AGENTS.md`). Two requests go to Lovable (D1 switch column, D2 trigger); the
  design works without them, with the stated fallbacks.
- `event_outbox.event_type` is free text and `integration_clients.scopes` is `text[]`: no migration for new
  event types or scopes.
- `src/services` files stay at or under 300 lines: new code goes in new files.
- Local dev cannot write; writes are proven with FakeDb tests and `e2e/file-hooks.py` on the preview.

## Components
| File | Role |
| --- | --- |
| `src/services/file-hook-rules.ts` (new, pure) | event names, opt-in set, payload whitelist, `stepTransition(state, detail, result)`, download rule, field validation (zod), limits, quarantine-rate rule |
| `src/services/file-hook-events.ts` (new) | `emitFileEvent` (D2 fallback, through `must()`), `repairMissing` for R2.10 |
| `src/services/external-processing.ts` (new) | organisation switch (D1 with fallback), active scanner/reader (D3), `startStep` (records mode, by, since, step, attempt), timeout step for the scheduled run |
| `src/services/gateway-file-results.ts` (new) | `postScanResult`, `postExtractionResult`, `confirmUpload` |
| routes | `document.$id.attachment.$attachmentId.scanResult.ts`, `.extractionResult.ts`, `.uploaded.ts` + `documentManagement/v4` twins |
| changed | `tmf667-shared.ts` (scopes), `integration-clients.functions.ts` (D3, D4, admin only), `gateway-core.ts` (D4 re-check), `tmf667-events.ts` (opt-in set, whitelist, `legalHold` on change events), `gateway-reads.ts` (download rule incl. quarantined versions), `pipeline.functions.ts` (guarded, step-aware retry, `externalPending`, server SHA-256), `gateway-create.ts` (ordering), `document-content.functions.ts` (addVersion carries quarantined versions, restore rule), `retention.functions.ts` (purge event with version ids), `maintenance.ts` (calls the timeout step), `use-upload.ts`, record page and panel (waiting, refetch, announcements), `upload-progress.tsx` (copy by reason), `connected-systems.tsx` (labels, switch, warnings), `document-labels.ts`, `limits.md` |

## pipeline_detail (jsonb, no schema change)
```json
{ "mode": "simulated|external", "by": "<system name>", "byClient": "<client id>", "since": "<iso>",
  "step": "scan|read", "attempt": 3, "reason": "threat|scanError|noResult|unreadable|noFile",
  "quarantinedVersions": ["<version id>"] }
```
`quarantinedVersions` is carried forward by addVersion and every transition, so D5 survives new versions.

## State machine
```text
uploading --confirmed (server SHA-256)--> scanning{mode, attempt+1}      emit Stored
scanning  --clean (external result | simulated)--> reading{attempt+1}  emit ReadyToRead
scanning  --infected--> quarantined (+ version to quarantinedVersions)
scanning  --error | timeout--> failed{step: scan}
reading   --read--> ready ; --unreadable--> failed{unreadable, step: read} ; --timeout--> failed{noResult, step: read}
failed    --Try again--> the failed step, attempt+1 (event again when external)
uploading --older than 24 h--> failed{noFile}
```
Every write is `updateDocumentIf` expecting `pipeline_state`, `current_version_id` and
`pipeline_detail.attempt`.

## Download rule (pure)
| Key or person | State of document | Version | Allowed |
| --- | --- | --- | --- |
| `read` key, person with access | not scanning, not quarantined | not in quarantinedVersions | yes (today's rule plus D5) |
| scanner | scanning, mode external | current | yes, and a download receipt (activity entry with attempt) is written |
| reader | reading, mode external | current | yes |
| anyone | any | in quarantinedVersions | no (409 `quarantined`) |

## Events (whitelist; `toTmfEvent` keeps only these)
| Event | Payload |
| --- | --- |
| DocumentFileStoredEvent | versionId (string), contentHash (string), sizeBytes (integer), mediaType (string), attempt (integer) |
| DocumentFileReadyToReadEvent | versionId, attempt |
| DocumentFilePurgedEvent | versionIds (string[]) |
| DocumentChangeEvent (existing) | adds legalHold (boolean) when the hold changed |
`eventMatches`: an `OPT_IN_EVENTS` set (batch + the three) is checked before the "no query" branch.

## Lovable requests (D1, D2)
1. Tenant column `external_processing jsonb default '{}'` (`{ scan: bool, read: bool }`).
2. A separate trigger `AFTER UPDATE OF pipeline_state, current_version_id, purged_at ON documents` emitting
   Stored (into scanning), ReadyToRead (into reading) and Purged (purged_at set), joining
   `document_versions` for hash, size and media type, skipping test-data resets; plus `legal_hold` in the
   payload of the existing attribute-change event.
When they land, the app-side emission and the D1 fallback are removed (tasks 9.x).

## DXP mapping
Events become Kafka records keyed by tenant and document. The callbacks become result events produced by
an antivirus or OCR Connector (southbound to the customer's system); the prototype endpoints map 1:1 to
those result events. `uploaded` maps to the storage port's `head()`.

## Docs to update
`docs/integration/tmf667-api.md`, `docs/rebuild/06-api/tmf667.md`, `contracts/seams/tmf667-document.openapi.yaml`,
`docs/architecture/limits.md`, `docs/rebuild/03-business-rules.md` (BR rules), `docs/rebuild/18-tenancy-and-data-protection.md`
(names, implemented), `docs/rebuild/05-screens/record.md` and `admin-systems.md`, `docs/architecture/accessibility.md`,
`docs/operations/regression-after-publish.md`, `src/routes/api/public/tmf-api/AGENTS.md`, then `bun run sync:rebuild`.
