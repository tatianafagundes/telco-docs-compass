# 03 — Business rules catalogue

Each rule is numbered and testable. The **Source** column names the reference implementation (copied verbatim into `reference/rules/`), and the **Test** column names the current test (copied into `reference/rule-tests/`). Reason texts are exact English copy. The rebuild must return identical strings so the parity scenarios pass.

Error shape for internal operations: `{code, category, retryable, customerFacing:{key, recoverable, nextAction, detail?}}`. Here `category` is validation, notFound, conflict, rejected, unavailable or unknown, and `retryable` is true only for unavailable.

## A. Roles and capabilities (`document-rules.ts`, `document-rules.test.ts`)
| ID | Rule |
|---|---|
| BR-001 | Role rank: viewer 0, contributor 1, reviewer 2, manager 3, tenant_admin 4, master_admin 4. |
| BR-002 | `edit` needs contributor or higher, `review` needs reviewer or higher, `manage` needs manager or higher. |
| BR-003 | A user has exactly one tenant and one role; master_admin is only valid in a master tenant (trigger `user_roles_guard`). |
| BR-004 | Shared-only access: a `view` share caps the person at viewer; `edit`/`manage` shares cap them at contributor, or viewer if the base role can't edit (`shareCappedRole`). The server applies it to every write and bulk change, not only the screens. Reviewing, approving and managing access need record access. |

## B. Status path (`document-rules.ts`, `document-actions.ts`)
| ID | Rule |
|---|---|
| BR-010 | Allowed transitions: draft→in_review; in_review→approved; approved→effective; effective→superseded or expired; superseded→archived; expired→archived; archived→none. Anything else is refused with `doc.transition.notAllowed`. |
| BR-010a | Sending for approval, approving and making effective need a checked file (`pipeline_state` ready, which includes a file kept without reading). Otherwise refused with `doc.transition.noFile` (API: 409 `fileMissing`; bulk: skipped "its file is not in yet"). The screen shows the step unavailable with where the file is. |
| BR-011 | in_review→draft happens only through "report problem / send back" (needs `review`). |
| BR-012 | Capability per target: in_review needs edit; approved needs review; every other target needs manage. |
| BR-013 | Frozen statuses are superseded, expired and archived. Editing details is refused with `doc.edit.frozen`. |
| BR-014 | Next-step labels: draft "Send for approval", in_review "Approve", approved "Make effective", effective "Mark as superseded", superseded and expired "Archive". |
| BR-015 | Role reasons: edit "Your role can view this document but not change it."; review "Only reviewers and managers can do this."; manage "Only managers and administrators can do this." |
| BR-016 | Frozen edit reason: "This document is closed, so its details are kept as they are." |
| BR-017 | Record summary: approved and effective documents count as the current version. Show at most 3, newest first, with "+N more" and a separate in-review list (`approvedSummary`). |

## C. Approval gate and four-eyes (`document-rules.ts`, `review-rules.ts`, `review-flow-rules.ts`, `document-write.functions.ts`)
| ID | Rule |
|---|---|
| BR-020 | Approve is refused while any spec characteristic with `required && extractable` lacks an accepted or edited field. The error is `doc.approve.requiredPending`, with detail = the count. |
| BR-021 | Gate reason: "1 required detail needs checking" or "N required details need checking". |
| BR-022 | Four-eyes: if `documents.created_by == caller`, approval is refused with `doc.approve.ownDocument`. Reason: "Someone other than the person who added it needs to approve it." Documents with a null creator (seeded or system) are exempt. This is enforced on the server and in the UI. The TMF API equivalent is BR-140, which also refuses a key approving a document added in the app by the person who connected that system. Bulk approval applies the same rule: a document the person added is skipped with the reason `ownDocument` (BR-106). |
| BR-023 | The system never auto-accepts extracted details, whatever the confidence. |
| BR-024 | Journey step: draft or in_review with pending details gives 0 (Check details), otherwise 1 (Approve). approved gives 2; effective gives 3 (done); any other status means no journey. |
| BR-025 | Footer action: when details are pending and the person can review, show "Next detail". In draft show "Send for approval". In in_review show "Approve document", unavailable for role, gate or four-eyes in that order. Otherwise show "Back to document". |
| BR-026 | Outcome text: "All details checked: X confirmed, Y corrected, Z not in the document." Zero parts are omitted; with no parts it reads "All details checked." |

## D. Detail review (`review-rules.ts`, `review-flow-rules.ts`)
| ID | Rule |
|---|---|
| BR-030 | Field statuses are pending ("Not checked yet"), accepted, edited and rejected. In the guided UI these show as Confirm, Correct and "Not in this document". |
| BR-031 | Confidence bands: high "High confidence", medium "Medium confidence", low "Low confidence". |
| BR-032 | Risk order: low, then medium, then high. Unknown confidence comes first; ties sort by name. |
| BR-033 | Page order: by page, then box y, then name. |
| BR-034 | Most urgent pending field: contract-critical (required) first, then flagged (record differs or format bad), then lowest band, then list position. |
| BR-035 | `nextToCheck` wraps around and returns -1 when nothing is pending. |
| BR-036 | Record match applies only to quoteNumber, orderNumber and contractNumber. Normalise to A–Z0–9 uppercase; values shorter than 4 characters give no result. The result is "matches" if the value is contained in the record name or id, otherwise "differs". Record values are never returned. |
| BR-037 | VAT format: SE + 10 digits + 01; NO + 9 digits + MVA; otherwise 2 letters + 2–13 alphanumerics. Hints, in order: "A Swedish VAT number is SE, 10 digits, then 01." / "A Norwegian VAT number is NO, 9 digits, then MVA." / "A VAT number starts with a two-letter country code." |
| BR-038 | A field ending in Date or Until must parse as a date, else the hint is "This doesn't read as a date." |
| BR-039 | Confidence reason priority: differs → bad format → matches → band ("Hard to read. Compare with the page." / "Partly clear. Worth a quick look." / "Clearly read.") → "No score. Compare with the page." |
| BR-040 | Accepting or editing copies the value into `documents.characteristic`. The audit event records the field **name only**, never the value. |
| BR-041 | Edited note: "Edited – read as <Band>: <original>". |
| BR-042 | Banner: "1 detail read from this document needs checking." / "N details read from this document need checking." |
| BR-043 | Unknown field codes are labelled by splitting camelCase into sentence case; the raw code is never shown. |

## E. Delete, hold and retention (`document-rules.ts`, `document-actions.ts`, `tenant-rules.ts`)
| ID | Rule |
|---|---|
| BR-050 | Delete blockers, in order: legal hold gives `doc.delete.legalHold` (detail = hold reason). retain_until today or later gives `doc.delete.retention` (detail = date): a keep-until date means kept through that day. created_at + group minRetentionDays later than today gives `doc.delete.retention` (detail = floor date). |
| BR-051 | Delete (soft) needs manage. Reasons: "A legal hold keeps this document safe. Release the hold first." / "This document must be kept until <date>." |
| BR-052 | Permanent deletion is for tenant_admin or master_admin only ("Only administrators can delete permanently."). It is blocked by a hold ("A legal hold blocks permanent deletion. Release the hold first.") or while retain_until is today or later: the same rule as soft delete. When it is refused, the reason reported is the role first, then the hold, then the date. |
| BR-053 | Permanent deletion sets `purged_at` and removes content; versions and events stay (tombstone). |
| BR-054 | Soft delete sets deleted_at and is recoverable through restore. |
| BR-055 | Effective retention = max(policy days, group minRetentionDays), with a `raised` flag. |
| BR-056 | Placing and releasing legal holds needs manage and records reason, reference and set-by. |

## F. Content and pipeline (`document-rules.ts`, `upload-rules.ts`)
| ID | Rule |
|---|---|
| BR-060 | Content is locked while pipeline_state is scanning or quarantined (`doc.content.locked`; TMF API answers 409 `contentLocked`). |
| BR-061 | Preview URL lives 300 s; download URL lives 60 s. |
| BR-062 | Pipeline: uploading→scanning→(quarantined | reading)→(failed | ready). Simulation: `.exe` or text TEST-QUARANTINE gives quarantined; TEST-UNREADABLE gives failed, and retrying fails again. |
| BR-063 | Default type: an account plus a file name containing contract, agreement, avtal, kontrakt or msa gives contract ("Based on: the file name mentions a contract"). Else orderAttachment ("Based on: added to an order" / "Based on: the safest general type"). Else none ("Choose a type for this file"). A type that has required fields to type is never picked by default. |
| BR-064 | Wrong file type: "<Type> accepts <PDF, PNG or JPEG> files. Choose another type, or another file." This blocks adding. |
| BR-065 | Too large: "This file is <size>. <Type> files can be up to <N> MB." This blocks adding. |
| BR-066 | Duplicate name (case-insensitive) within the record: "A document called <name> is already here." This only warns. |
| BR-067 | Upload progress never reaches 100% until every file is checked (capped at 99). |
| BR-068 | Size format: B, then KB (rounded), then MB with 1 decimal. Long names are truncated in the middle and keep the extension (max 40). |
| BR-069 | Short record id: `ord-se-7731` becomes `O-7731`. |

## G. Idempotency (`document-rules.ts`)
| ID | Rule |
|---|---|
| BR-070 | Request hash = SHA-256 of a stable JSON form (sorted keys, undefined dropped). |
| BR-071 | No stored key: run as fresh. Same hash: replay the stored response. Different hash: conflict (`seam.idempotency.mismatch`; TMF 409). |
| BR-072 | Idempotency keys expire after 24 h. |
| BR-073 | A write to a document first checks that the caller can see it and that it belongs to the caller's tenant, and only then looks at the idempotency key. A document of another tenant, a missing document and an invisible one all answer `doc.notFound`. If visibility cannot be checked the answer is `seam.unavailable`, never `doc.notFound`. Revoked access cannot be bypassed by repeating an earlier request. |
| BR-074 | A write to a document that is refused because the caller cannot see it, because it belongs to another tenant, or because it does not exist, is recorded in the activity log, at most 20 per person per minute (counted per server instance, so approximate). Beyond that the write is still refused and one summary entry (`accessDeniedSuppressed`) is recorded for the window. Refusals for a too-low role are not part of this rule. |

## H. Group configuration (`tenant-rules.ts`)
| ID | Rule |
|---|---|
| BR-080 | Only tenant_admin or master_admin may change configuration (`access.roleTooLow`). |
| BR-081 | A country may not change a locked type ("Locked by <group>.") or any type when the area mode is locked or inherit ("Document types are set by <group>."). |
| BR-082 | In extend mode a country may change only containsPersonalData and requiresReview on group types (`config.extendOnly`). |
| BR-083 | Retention below the group floor is refused: "Retention cannot be shorter than N years. Set by <group>." Years = round(days/365). |
| BR-084 | Setting source labels (within 20 characters): inherited "Inherited", changed "Changed here", locked "Locked", own "Added here". The group is named once per screen: "Inherited and Locked settings come from <group>." |
| BR-085 | Relation sentence: extend "Adds its own to the group's setting", override "Replaces the group's setting", locked "Locked by the group", default "Uses the group's setting". |
| BR-086 | Impact text: "Applies to N tenants. M tenant(s) has/have overridden this and keeps its/keep their version." |
| BR-087 | Effective specification = group row if locked, else the country row if present, else the group row. It is visible only to callers in that tenant. |

## I. Access and sharing (`review-rules.ts`, `document-write.functions.ts`, SQL `can_see_document`)
| ID | Rule |
|---|---|
| BR-090 | Visible means: not deleted and not purged, and either (a) same tenant and (tenant_admin, or entity_access on a related record, or an unexpired share), or (b) an unrevoked, unexpired cross-tenant grant to the caller's tenant. |
| BR-091 | Cross-tenant sharing needs tenant.cross_tenant_share = explicitGrant (`access.crossTenant.off`); target must be another tenant (`access.subject.sameTenant`). |
| BR-092 | "Why can I see this": via a record gives "…because you can view/edit <record>." A share gives "…because <who> shared it with you[ until <date>]." Otherwise "…because your role covers every record in your organisation." Expired items are ignored. |
| BR-093 | Shared with me returns a record id only if the caller can read that record, and never returns record names. |
| BR-094 | Removing a share takes effect at once on the list and on direct links. |
| BR-095 | Clients may write only `view` and `download` audit events. Every other event is written by the operation itself. |
| BR-096 | Activity and people lists use 20 rows per page. |

## J. Search and bulk (`search-rules.ts`)
| ID | Rule |
|---|---|
| BR-100 | Filters: q ≤200; types ≤30; statuses ≤7; sensitivity ≤4; entityTypes ≤10; entityId; hold; review; changedAfter (date); expiringBefore (date); sort ∈ updated, name, expiry. |
| BR-101 | Normalise: trim q, de-duplicate and sort arrays, drop empty values, drop sort=updated (the default). |
| BR-102 | Page size 50, keyset cursor {v,id}. v = updated_at, name or expiry_date ("" when null). Fetch size+1 to detect the next page. |
| BR-103 | Count cap 10,000: "More than 10,000 documents", otherwise "N document(s)" (en-GB grouping). |
| BR-104 | Identifier detection: 3–64 characters, no spaces, contains a digit, matches `^[A-Za-z0-9][A-Za-z0-9._/-]*$`. Such a query offers a jump to the record. |
| BR-105 | Bulk limit 10,000 documents, processed in batches of 200 (`bulk.tooMany`, `bulk.empty`). |
| BR-106 | Bulk skip reasons: noPermission, frozen, notAllowed, ownDocument (four-eyes, approval only), detailsPending, notFound, unchanged. Each has an exact label (see source) and the same rules as single actions. Holds need manage; sensitivity needs edit and not frozen. |
| BR-107 | Bulk summary: "X of N changed · K skipped because <label>". |
| BR-108 | Each document in a bulk job is re-checked and audited individually. The role used is the one the person who started the job has when the batch runs, not the one stored when it was created. A failed read or write of the documents, or a failed audit entry, fails the job and is never counted as a change. If the starter's role cannot be read the job is left untouched and retried on the next pass; if they no longer have a role the job fails. |
| BR-109 | A bulk job is held by one worker at a time: a worker claims the next batch only if nobody moved the job since it read it, and the status alternates queued and running between batches. A worker that stops mid-batch is detected when its lease runs out and the job becomes failed. A job ends done only when changed plus skipped equals total; a missing role or a corrupted document list makes it failed. |

## K. API rate limits (`rate-limit-rules.ts`)
| ID | Rule |
|---|---|
| BR-110 | Defaults are 120 reads and 30 changes per minute per connected system. Bounds: reads 1–6000, changes 1–1000, integers only. |
| BR-111 | GET and HEAD count as reads; everything else counts as a change. |
| BR-112 | Allowed when hits (including this request) ≤ limit. reset = max(1, 60 − current UTC second). |
| BR-113 | Headers: RateLimit-Limit/Remaining/Reset/Policy (`<limit>;w=60`), X-RateLimit-Limit/Remaining; Retry-After only on 429. |
| BR-114 | The 429 message names the limit and the wait, says other systems are not affected, and points to Admin > Connected systems. |
| BR-115 | Counters are kept per system and kind. One system can never use up another's allowance. |

## L. Event delivery (`event-delivery-rules.ts`, `tmf667-mapper.ts`)
| ID | Rule |
|---|---|
| BR-120 | Delivered means HTTP 2xx. |
| BR-121 | Up to 6 attempts. Backoff after failures 1–5: 30, 120, 600, 1800, 7200 s. The subscriber's Retry-After is honoured up to 3600 s; the wait is max(backoff, Retry-After). |
| BR-122 | Retry-After may be given in seconds or as an HTTP date. An invalid value is ignored. |
| BR-123 | Subscribers receive only events created at or after their subscription. |
| BR-124 | Signature: header `X-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")` with headers `X-Signature-Timestamp` and `X-Event-Id`. Receivers reject timestamps more than 300 s off. Comparison is constant-time. |
| BR-125 | One delivery row per (event, subscription), claimed with a lock (SKIP LOCKED). One subscriber's failure never re-sends to others, and overlapping passes never send twice. |
| BR-126 | Events carry id, href and status only, never document content; file events add their whitelisted file facts (BR-151). Subscriptions are same-tenant only. |
| BR-127 | Event names: DocumentCreateEvent, DocumentStateChangeEvent (changed: status), DocumentAttributeValueChangeEvent (attachment, characteristic, legalHold), DocumentDeleteEvent (status "deleted"). |
| BR-128 | Fan-out hands an event to every matching subscription before it is marked delivered. If the subscriptions or the document facts cannot be read, or the deliveries cannot be queued, the event stays pending and the next pass repeats it. |
| BR-129 | When a claimed delivery's event or subscription cannot be read, the delivery is given back without counting an attempt and waits 30 s. If both can be read but one is missing, it counts as a failed attempt (backoff, then given up after the last one). If they belong to different tenants it is given up at once and nothing is sent. The lock on claimed deliveries lasts longer than the slowest possible pass. |

## M. TMF mapping (`tmf667-mapper.ts`, `tmf667-mapper.test.ts`)
| ID | Rule |
|---|---|
| BR-130 | Status mapping: draft→created, in_review→reviewed, approved→approved, effective→published, superseded/expired/archived→archived; a deleted document is "deleted". |
| BR-131 | PATCH status target: created→draft, reviewed→in_review, approved→approved, published→effective, archived→archived. Any other value is refused. |
| BR-132 | Scopes are read, register, transition, approve, hold, delete, subscribe, and the processing scopes scan and extract (BR-163). Approving needs `approve`; other transitions need `transition`. |
| BR-133 | Referred type: Account is shown as BillingAccount (and BillingAccount maps back to Account). |
| BR-134 | Paging: default limit 20, max 100. |
| BR-135 | Unknown status or lifecycleState values give a 400 `invalidQuery`. status and lifecycleState filters combine by intersection. |
| BR-136 | Keys last 365 days and are stored only as SHA-256 hashes. Prefixes: `erad_` for keys, `eradt_` for OAuth tokens (15 min). |
| BR-137 | Inline attachment ≤ 5 MB; URL attachment fetch ≤ 25 MB, with a DNS check that rejects private addresses. |
| BR-138 | Unknown paths and methods return TMF error JSON (404/405), never HTML. |
| BR-139 | The legacy base `/documentManagement/v4` remains an alias until 10 May 2027. |
| BR-140 | TMF API four-eyes: a system key cannot approve (PATCH status or /transition) a document it registered, nor a document added in the app by the person who connected that system (`integration_clients.created_by`); 409 `fourEyesRequired`. |
| BR-141 | Replies carry `category` as `CategoryRef` objects (document type business-process names as `id` and `name`) and `document` refs to same-tenant bundle siblings; `validFor` values are UTC date-times (start of the effective day, end of the expiry day); specifications carry `isBundle: false`, `targetEntitySchema` and a TMF `lifecycleStatus` (inDesign → created, active → published, retired → archived). |
| BR-142 | A bulk change pass writes one `DocumentBatchEvent` listing changed ids; it is delivered only to subscriptions whose query names DocumentBatchEvent. |

### BR-143 Approved content is protected
On approved or effective documents, name and description (plus sensitivity and record links) can still change. Confirmed details, dates (expiry/validFor) and file versions cannot; the API replies 409 `approvedContentLocked`. Superseded, expired and archived documents stay fully closed. Tests: `document-rules.test.ts` "approved content protection", `e2e/tmf-api.py` section 4.
## N. File hooks (`file-hook-rules.ts`, `file-hook-detail.ts`, `file-hook-download.ts`, `file-hook-fields.ts`, `file-hook-timeouts.ts`, `file-hook-text.ts`)
Spec: `.kiro/specs/file-hooks`. The rules below are implemented as pure functions with tests; the endpoints and screens that use them are built in later phases of that spec, and each rule says where it is used today.
| Id | Rule |
| --- | --- |
| BR-150 | File events: `DocumentFileStoredEvent` {versionId, contentHash, sizeBytes, mediaType, attempt} when a document enters scanning, `DocumentFileReadyToReadEvent` {versionId, attempt} when it enters reading, `DocumentFilePurgedEvent` {versionIds} on permanent deletion. Written by the database trigger in the same transaction as the change (migrations 0016–0018). Declared extensions, not TMF667 standard events. |
| BR-151 | File events reach only subscriptions whose query names them exactly, and then the status and document type filters apply. Delivered under `event.file`, with only the whitelisted keys of the right type (own properties; anything else is dropped). |
| BR-152 | A legal hold change is a DocumentChangeEvent with `changedAttributes: ["legalHold"]` and no hold value, reason or reference; a no-op hold emits nothing. A hold change made with a version or characteristic change gives two events. |
| BR-153 | Processing steps: uploading → scanning (confirmed) → reading (clean) → ready (read). Infected → quarantined; scan error → failed (scan); unreadable → failed (read); no answer from an outside system → failed (noResult, that step); an upload never confirmed → failed (noFile). Each step start records mode, system, start time, step and a new attempt in `pipeline_detail`. |
| BR-154 | Every processing write is guarded on the state as read, the stored attempt text and the current version, so two results racing for one step cannot both apply. A stored attempt the database cannot compare refuses the change. Keep without reading and adding a version are guarded the same way, so neither overwrites a scan result or marks an unchecked version ready. |
| BR-155 | Quarantine is per version and permanent: a quarantined version is never downloaded, restored, made current or processed again by any key or person. The list is never shortened; past 1000 entries a new version is refused. A document quarantined before the list existed gets its current version added when a new version is added. A restore is refused when the source shares its stored file or bytes with a quarantined version. |
| BR-156 | A step recorded as external is answered only by the system recorded for it, for its current attempt; simulated advancing of it is refused (`externalPending`). The same result again from that system for that attempt is answered with the stored outcome (`replay`). |
| BR-157 | The server hashes the stored file (full SHA-256, stored as `sha256:<hex>` from the screens or bare hex from the API) and checks its size against the declared one before the scan starts; files over 25 MB are refused. Keep without reading is only for a reading failure. Try again restarts the step that failed (from the failure reason when an older detail did not record it), with a new attempt, and follows the organisation switch as it is now. A file that never arrived is added again, not retried. |
| BR-158 | Timeouts: an external step fails after 30 minutes without an answer (from its start time, or from the document's last change when that is missing); an upload fails after 24 hours unconfirmed. A simulated step never times out. A timed-out step never becomes clean or ready. |
| BR-159 | Downloads: people and `read` keys get only the current version, once it passed the check (ready, reading, or failed while reading): never while uploading, scanning or quarantined, after a failed or unanswered scan, or when the file never arrived (409 `contentLocked`); an older version 409 `notCurrent`, since it may have been replaced before its scan. A scanner or reader downloads only the current version, only during its own external step, only as the recorded system. The link is given only after its record is written: a scanner's receipt (`scanDownload`, checked by a `clean` result) or the download activity. |
| BR-160 | A reader's fields are checked as a whole before anything is written: names exactly as the type's details, no duplicates, values of the detail's type (string, number, date as a real calendar day, enum from its list, boolean), text without controls, lone surrogates, separators, bidi or invisible characters and at most 2000 code points, confidence in [0, 1], source a short plain label, at most 100 fields. One bad field refuses all. |
| BR-161 | Accepted reader fields are proposals only: pending details marked as from the system, never confirmed without a person (BR-023). Band: High at 0.90 or more (a detail's own threshold can only raise this), Medium at 0.70 or more, Low below. |
| BR-162 | Text from outside systems that people see (system names, unknown field names) has unsafe characters replaced and is cut by code points; it is still escaped when shown. Threat names appear only in the activity log. |
| BR-163 | Processing keys: a key with `scan` (the organisation's own antivirus) or `extract` (its own reader) has that one scope only, and an organisation has at most one such key of each kind that is not disconnected (an expired one still counts until it is disconnected or renewed). Checked when the key is created (organisation administrator only), on every API call (403 `notDesignated`), and by the database (migration 0020). |
| BR-164 | The organisation switch (`tenants.external_processing`, `{scan, read}`, true or false only) is set by the organisation administrator only, through one database call that changes only the named steps and records each change in the same transaction (`configChange`). Off: the built-in simulated check and reading. On: a step that starts waits for the organisation's active key for it; with none, the step still waits, names no system and fails after the timeout. Turning a key off never turns simulation back on; a document keeps the mode it started its step with. Where the switch's column does not exist yet it is off; any other failure to read it, or a stored value that is not a switch, stops the step. Any member of the organisation can see the switch through the database; only the administrator can change it. |
| BR-165 | Connecting, disconnecting and rotating the key of a system are recorded in the activity log by name (and scopes when connecting), with unsafe characters replaced; the key and its prefix never are. A key whose creation cannot be recorded is revoked again. A processing key that is not the organisation's connected system gets no OAuth token and is refused after the rate limit counts it. |
| BR-166 | Results from the organisation's own systems: `scanResult` and `extractionResult` are checked in order (key and scope, designated system, document and version of the key's organisation as one 404, current version, the step waits for this system and attempt, the hash, for `clean` the receipt) and write nothing when refused. The same result again for the same attempt is answered with the outcome (`replayed`), also after the built-in reading ran. A malformed id is 404 before the Idempotency-Key is remembered. A reader's answer is at most 1 000 000 bytes. |
| BR-167 | A reader's details are saved as pending proposals marked with the system, after the whole answer passed; a person's existing detail for the version is kept and named as skipped. When the document moved meanwhile, the proposals are taken back; if that fails the log names the rows (never a value). An error reading the document types answers 503. |
| BR-168 | A file registered through the API (inline, by url, or uploaded with `uploadUrl` and confirmed with `POST …/uploaded` by the system that registered it) is stored as uploading and goes through the same checks as an upload from the screens; the server runs the built-in steps itself. A version declared over 25 MB is refused before it is fetched. A system's activity is recorded against the version, with its cleaned name kept whole. |
