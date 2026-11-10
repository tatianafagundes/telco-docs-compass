# Finish the TMF667 v4 conformance audit fixes

Checking the audit against the code shows that almost everything is done. That covers the standard address, status values, attachment arrays, PATCH, DELETE, v4 event names, the declared extension schema, externalIdentifier, relatedParty, BillingAccount, hub filters, request limits, signed timestamps, DNS re-checks, key expiry and OAuth. Five gaps remain.

## Remaining gaps
1. **Four-eyes rule over the API (security, high).** In the app, the person who added a document cannot approve it. The API does not check this yet, so a system that registered a document could approve it with its own key. Fix: when a system approves (by PATCH `status` or by `/transition`), refuse with 409 if the same system key registered the document. Another key, or a person in the app, can still approve it.
2. **Links to other versions (`document` refs, medium).** Return a `document` list that links a document to the version it replaced and the version that replaced it (role `supersedes` / `supersededBy`). These are reference links only, filtered by the same access rules.
3. **`category` (optional field).** Fill it from the document type's business process (for example Sales, Delivery, Assurance). It is read-only.
4. **Document types: `targetEntitySchema` and `isBundle`.** Add them to replies so standard clients get every core field. `isBundle` is always false.
5. **`DocumentBatchEvent` (medium).** When a bulk change from the Documents page affects many documents, subscribers get one batch event per pass instead of one event per document. Only subscriptions that ask for `DocumentBatchEvent` receive it; the others keep getting per-document `DocumentChangeEvent`s as now.

## Not code (stays open)
- Automatic event delivery only runs once the app is published. This is an operational step for you.

## Checks
- Mapper unit tests: version links, category, document-type fields, batch-event envelope.
- `e2e/tmf-api.py` adds checks that:
  - the same key approving its own document gets 409;
  - a second key can approve it;
  - version links and category validate against the official v4 schema.
- `e2e/tmf-events.py` adds batch-event delivery and dedupe.
- Existing 107 API, 45 event and 15 rate checks keep passing.
- Update the OpenAPI contract's conformance profile, the handbook (`docs/rebuild`) and its BR traceability row for four-eyes. Then write a new `tmf667-v4-conformance-audit_v2.pdf` listing every finding as fixed.

## Technical details
- Four-eyes: `documents.registered_by_client` (nullable uuid). The gateway sets it on POST. The pure check goes in `document-rules.ts` next to the app's four-eyes rule (tested). The gateway checks it before running the transition.
- Version links: built from `superseded_by` / the predecessor lookup in `tmf667-mapper.ts`. Ids are included only when `can_see_document` passes for the key's tenant.
- Batch events: `bulk-worker.ts` writes one outbox row of kind `batch` with the document ids, capped per pass. Fan-out in `event-delivery-rules.ts` routes it only to subscriptions whose query names DocumentBatchEvent.
