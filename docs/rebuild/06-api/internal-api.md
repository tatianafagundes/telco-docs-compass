# Internal API (screens ↔ server)

Contract: `contracts/seams/document.openapi.yaml`. Current implementation: authenticated server functions, one per operation. Each returns `SeamResult` = `{ok:true,data}` or `{ok:false,error:SeamError}`, and never throws to the client. Reads run as the caller (visibility rule); writes check the role and access, write, then audit.

In the rebuild, expose these as REST endpoints under `/api/v1` with the same error object. Angular maps `customerFacing.key` to copy.

## Operations
| Operation | Purpose | Who | Key errors |
|---|---|---|---|
| getMe | current user id, tenant, role, access | any | – |
| listEntities | records the caller can see | any | – |
| get | one document | visible | doc.notFound |
| listVersions | versions of a document | visible | doc.notFound |
| getExtraction | details read from the document, with reviewed_at | visible | – |
| listSpecifications | effective document types | any | – |
| getTenantPolicy | tenant settings and hard floors | any | – |
| recordAccess | append a `view` or `download` event | visible | (only these two actions) |
| listActivity | audit events, 20 per page | visible | – |
| searchPeople | people in the tenant, for sharing | manager+ | – |
| listSharedWithMe | documents shared directly with the caller | any | (BR-093) |
| find | quick find by name or identifier | any | – |
| register | create a document on a record | contributor+ and record edit | doc.type.unknown, doc.type.mimeNotAccepted, doc.type.tooLarge, entity.notFound, doc.register.failed, seam.idempotency.mismatch |
| updateMetadata | change name, description, dates, sensitivity, details | edit, not frozen | doc.edit.frozen |
| addVersion | new immutable version | edit | doc.edit.frozen |
| getContentUrl | preview link (300 s) or download link (60 s) | visible | doc.content.locked, doc.content.unavailable, doc.version.notFound |
| transition | status change | BR-012 | doc.transition.notAllowed, doc.approve.requiredPending, doc.approve.ownDocument |
| setHold | place or release a legal hold | manage | – |
| deleteDocument / restoreDeleted | soft delete and undo | manage | doc.delete.legalHold, doc.delete.retention |
| reportProblem | send back to draft, or "keep unread" for failed reads | review | doc.keepUnread.notFailed |
| grantAccess / revokeAccess / listAccess | shares and cross-tenant grants | manage | access.subject.notFound, access.subject.sameTenant, access.crossTenant.off |
| reviewExtraction | accept, edit or reject one detail | review | extraction.field.notFound, doc.edit.frozen |
| searchDocuments / countDocuments / facetDocuments | search (see 08) | any | search.failed |
| findRecord | jump to a record by identifier | any | – |
| listSavedViews / saveView / deleteView | personal and team views (team views are admin only) | any | view.notFound |
| startBulkJob / getBulkJob | bulk changes (see 08) | per document | bulk.tooMany, bulk.empty, bulk.notFound |
| advancePipeline | move the simulated pipeline on | uploader | pipeline.notUploaded |
| resetTestData | remove test artefacts | master admin | reset.notTestData, reset.failed |
| listHolds / retentionOverview / deletionHistory / verifyHolds / purgeDocument / retentionFor | retention and holds | admin (purge BR-052) | doc.delete.* |
| getConfig / listChildTenants / getChildView / specUsage / saveSpecification / resetSpecification | group and country configuration | admin | access.roleTooLow, config.locked, config.extendOnly, config.belowFloor, config.unknownPolicy, config.notOverridden, tenant.notFound |
| listSystems / createSystem / rotateSystemKey / revokeSystem / updateSystemLimits | connected systems | tenant admin | system.notFound |

Common errors: `seam.unavailable` (retryable), `access.none`, `access.roleTooLow`, `documents.loadFailed`.

## Idempotency
Write operations accept an idempotency key. The behaviour follows BR-070–072.
