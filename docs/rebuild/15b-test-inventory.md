# Existing test inventory (parity checklist)

Every line below is an assertion in the current app. The rebuilt app needs an equivalent passing test. Generated from the source.


## access.integration.test.ts

- should show the Sweden manager all 11 Sweden records and no Norway records
- should show the Sweden admin every Sweden record
- should limit the Sweden viewer to order ord-se-7731
- should never show Sweden documents to the Norway manager
- should give the master admin no tenant records
- should refuse direct document edits from any signed-in account
- should show the Sweden viewer only documents on order ord-se-7731
- should not let any account list stored files directly

## document-actions.test.ts

- document actions
- should offer approve to a manager when the document is in review
- should keep approve unavailable with a reason for a contributor
- should offer no next step when archived
- should not let a viewer edit details
- should not let anyone edit a superseded document
- should only offer send back while in review
- should block delete under legal hold or retention
- purgeState
- should block permanent deletion under legal hold
- should block permanent deletion before the keep-until date
- should allow only administrators
- sharedOnlyRole
- should cap a manager at viewer when the share is view only
- should cap a manager at contributor when the share allows editing
- should keep a viewer as viewer even with an edit share
- approvedSummary
- should show only approved and effective documents when a record has mixed statuses
- should cap at 3 and count the rest when there are more
- should list documents in review when none is approved

## document-rules.test.ts

- document-rules
- should allow the forward status path
- should refuse skipping steps and going back through transition
- should require reviewer to approve and manager to make effective
- should block approve while a required detail is pending
- should block delete under legal hold with the hold reason
- should block delete under retention and the master 1825-day floor
- should lock content while scanning or quarantined
- should replay the same body and conflict on a different body
- should let clients record only view and download

## event-delivery-rules.test.ts

- event-delivery-rules
- should mark any 2xx reply as delivered
- should retry after 30 s, 2 min, 10 min, 30 min and 2 h
- should give up after six attempts
- should retry when the subscriber was unreachable
- should honour a longer Retry-After, capped at one hour
- should read Retry-After as seconds or an HTTP date
- should send only events that happened after subscribing
- should accept a correct recent signature and refuse tampering, wrong secrets and replays

## rate-limit-rules.test.ts

- rate-limit-rules
- should allow the request that reaches the limit exactly
- should refuse the first request over the limit
- should tell the caller to wait until the minute ends
- should send Retry-After only when refusing
- should count GET and HEAD as reads and everything else as changes
- should accept limits only within bounds
- read
- read
- read
- write
- write
- write
- read
- should name the wait time in the guidance

## review-flow-rules.test.ts

- review-flow-rules
- should place a document with unchecked details on the check step
- should offer Next detail while details remain
- should offer Approve document once everything is checked
- should block the author from approving their own document
- should keep approval closed while required details are unconfirmed
- should offer Send for approval on a draft
- should let a viewer only go back
- should say whether a quote number matches the record without exposing it
- should check Swedish and Norwegian VAT formats
- should explain confidence with telecom checks first
- should treat required details as contract-critical
- should order details as they appear on the page
- should go to contract-critical, then least certain unchecked details first
- should summarise the outcome

## review-rules.test.ts

- review rules
- should keep Approve unavailable while required details are not checked
- should allow Approve when required details are accepted or edited
- should order Low before Medium before High
- should jump to the next unchecked field and wrap round
- should use plain labels, never codes
- should word the banner and the edited note as agreed
- why can I see this
- should explain access through the record
- should explain a personal share with its end date
- should ignore an expired share

## search-rules.test.ts

- splitPage
- should return a cursor from the last shown row when one extra row came back
- should return no cursor on the last page
- should use the name for the name sort
- countLabel
- should cap at 10,000
- normaliseFilters
- should drop empty values and the default sort so equal searches share a key
- looksLikeIdentifier
- should treat order and quote numbers as identifiers and words as text
- bulkSkipReason
- should skip holds when the role is below manager
- should skip approval while required details are pending
- should skip a status that is not the next step
- should skip sensitivity changes on frozen documents
- should report missing documents
- bulkSummary
- should list each skip reason with its count

## share-isolation.integration.test.ts

- should still let the Sweden manager read the quote, so the checks above are meaningful

## tenant-rules.test.ts

- tenant-rules
- should label sources with the real organisation name
- should read changed fields from overridden_fields
- should reject retention below the group floor with a sentence naming it
- should reject changes to a locked type
- should reject changes from roles below admin
- should allow only additive changes in extend mode
- should allow a valid override
- should describe impact on children
- should raise a shorter local retention to the group minimum
- should describe inheritance modes in one sentence

## tmf667-mapper.test.ts

- toTmfDocument
- should map versions to attachments and mark the current one
- should drop malformed characteristics
- parseListQuery
- should cap limit at the maximum when a larger one is asked
- should accept a comma list of lifecycle states for the approved-version lookup
- should reject an unknown lifecycle state with a 400
- should reject a negative offset
- selectFields
- should always keep id, href and @type
- scopes
- should need the approve scope to approve
- should not let a read-only key register documents
- readBearer
- should accept only erad_ system keys
- events
- should match subscription filters by eventType
- should never include characteristic values in the event
- should refuse non-https or internal callback addresses
- TMF667 v4 status
- should map every internal state to the v4 DocumentStatusType
- should expand a status filter to every matching internal state
- should accept status= in list queries and intersect it with lifecycleState
- should map PATCH status targets and refuse deleted
- should return status and lifecycleState on documents
- TMF667 v4 data model
- should give each attachment a url, href and attachmentType
- should use SID names for referred types
- should carry the owner and external identifiers
- should express file rules as specCharacteristic
- TMF667 v4 events
- should send v4 event names by default
- should keep the old name for subscriptions that asked for it
- should match v4 names, status and documentType filters
- should fill the v4 envelope fields
- should sign timestamp and body together
- callback address checks
- should treat private, loopback, link-local and CGNAT addresses as private

## upload-rules.test.ts

- upload rules
- should default to order attachment when added to an order
- should default to contract on an account only when the name has a contract word
- should never default to a type with required typed fields
- should block files over the size limit of 100 MB
- should block a file type the document type doesn't accept
- should only warn on a duplicate name
- should quarantine .exe files and TEST-QUARANTINE content
- should walk uploading to ready, or stop at quarantined/failed
- should summarise a finished batch as '3 added: 2 ready, 1 needs attention'
- should never show 100 % while files are still being checked
- should keep the extension when shortening names
- should shorten entity ids for the drop overlay

## share-isolation.py (end-to-end)

- Norway page {path} shows no Sweden details
- Norway replies for {path} contain no Sweden details ({len(no_replies)} replies)
- Remove access
- viewer's Shared with me lists the quote
- viewer can open the quote by direct link while shared
- record line is hidden for the viewer
- no reply to the viewer contains the record name or id
- share removed
- viewer's Shared with me no longer lists the quote
- viewer list replies contain no quote details
- viewer's direct link shows unavailable
- viewer direct-link replies contain no quote details

## tmf-api.py (end-to-end)

- Order care finds approved/effective documents for {ORDER} ({len(j or [])})
- lifecycleState
- expiresInSeconds
- Download link fetches the file
- lifecycleState
- uploadUrl
- lifecycleState
- Approval answers with a clear result (HTTP {r.status_code}, {(j or {}).get('code')})
- X-Total-Count
- Attaching to an unknown ticket is refused with 404
- CRM lists {t} documents ({len(j or [])})
- {t} documents show sensitivity
- List returns a JSON array
- Each document has id, href, @type, relatedEntity, attachment, lifecycleState
- @baseType
- X-Result-Count
- offset/limit pages line up
- limit above 100 is capped at 100
- fields=name keeps only id, href, @type, name
- href resolves to the same document
- {label} → 400 TMF error
- documentSpecification list returns typed specs
- documentSpecification by id resolves
- X-Request-ID
- unsupported method → 405 TMF error with Allow header
- unknown API address → 404 TMF error
- {label} → 401
- read-only key cannot add documents (403)
- read-only key cannot change status (403)
- read-only key cannot place holds (403)
- read-only key cannot subscribe (403)
- Sweden key gets 404 for a Norway document
- Sweden key cannot download a Norway file
- Filtering by a Norway order returns nothing
- Sweden key cannot change a Norway document
- Sweden key cannot attach to a Norway order
- non-UUID id → 404, no server error
- injection-style filter returns nothing
- invalid JSON → 400
- change body over 50,000 characters → 400
- registration body over the 5 MB inline limit → 400
- unsafe callback refused: {cb}
- draft → effective (skipping steps) is refused
- expired document details can't be edited
- (renamed)
- unknown fields in a change are refused
- a hold without a reason is refused
- legalHold
- legalHold
- Idempotent-Replay
- the repeat did not create a second document
- same key with a different body → 409
- a change without Idempotency-Key → 400
- subscription created with a one-time signing secret
- standard subscription (eventType=DocumentChangeEvent) created
- event delivered to the subscriber within 150 seconds
- X-Signature matches HMAC-SHA256 of timestamp.body
- X-Signature-Timestamp is recent (replay protection)
- eventType
- event carries no document content or details
- eventType
- timeOcurred
- unsubscribe → 204
- GET /tmf-api/document/v4/document works ({len(lst or [])})
- every document conforms to the official v4 Document definition {issues[:5] or ''}
- href uses the standard address
- status=published filter (effective documents)
- BillingAccount (SID name) filter and replies
- Deprecation
- documentSpecification lists specCharacteristic
- POST with attachment[] + inline content → 201 created (HTTP {r.status_code})
- contentHash
- attachment.url gives back the same file
- find by externalIdentifier.id (CPQ quote number)
- attachment url pointing at a private address is refused
- PATCH status=reviewed (merge-patch)
- PATCH status needs the transition/approve permission
- requiredDetailsPending
- PATCH status can't skip steps
- PATCH characteristic merges by name
- PATCH with an unsupported content type → 415
- status=deleted is refused on PATCH (use DELETE)
- DELETE is blocked by a legal hold
- DELETE needs the delete permission
- DELETE → 204
- deleted document is gone from the API
- expires_in
- the token works as a bearer
- the token keeps the key's permissions (read-only)
- wrong secret → 401 invalid_client
- over 120 reads a minute → 429 with Retry-After ({len(limited)} of 135)
- no more than 120 reads were served in the minute
- admin screen issued two system keys
- download link stops working after 60 seconds
- a disconnected key stops working straight away
- no Norway details in any of {len(bodies)} replies to Sweden keys {leaked or ''}

## tmf-events.py (end-to-end)

- subscribe without a key → 401
- subscribe with a key lacking 'subscribe' → 403
- unsafe callback refused: {bad}
- sender endpoint without the scheduler token → 401
- sender endpoint with a wrong token → 401
- three subscriptions created (Sweden A, Sweden B, Norway N)
- a system cannot remove another system's subscription
- a Norway system cannot remove a Sweden subscription
- Sweden document moved to review (second event)
- A received the create and the move-to-review events ({types})
- each event arrived once, with its own X-Event-Id
- A's events carry a valid, recent signature for A's secret
- A's events do not verify with B's secret
- x-delivery-attempt
- x-event-id
- x-event-id
- N received its Norway event
- N received nothing about the Sweden document
- A and B received nothing about the Norway document
- no Norway identifiers anywhere in Sweden deliveries
- N's events verify with N's own secret
- B's {len(se_ids)} deliveries recorded as failed once (503)
- next try scheduled about 30 s later ({[round(w) for w in waits]})
- A's deliveries recorded as delivered after one try
- B is not retried before its backoff ends
- A is not sent anything again (no duplicates for a healthy subscriber)
- x-delivery-attempt
- x-event-id
- retries keep the same eventId in the body
- retries are freshly signed with a valid timestamp
- B's deliveries now recorded as delivered
- A still received each event exactly once while B was retried
- a receiver that keys on X-Event-Id processes {k} events from {2 * k} deliveries
- three passes at once still deliver each new event once to A ({[len(x) for x in per_doc]})
- A never received the same event id twice ({len(ids)} deliveries)
- B is tried 6 times per event then stops ({by_event})
- those deliveries are recorded as given up after 6 attempts
- A received each of those events once, unaffected by B's failures
- A unsubscribes → 204
- N's last event was not yet sent when its system was disconnected
- nothing is sent to A after it unsubscribed
- nothing is sent to N after its system was disconnected

## tmf-rate-isolation.py (end-to-end)

- A is served exactly its 5 reads ({served_a} of 12)
- A's other 7 reads get 429 ({len(limited)})
- 429 body is a TMF error with code tooManyRequests
- 429 message gives retry guidance
- Retry-After is 1–60 seconds ({ra_s})
- RateLimit-Limit
- RateLimit-Policy
- B's 30 reads all succeed while A is limited ({sum(1 for r in rb if r.status_code == 200)} of 30)
- A gets 2 changes, then 429 ({pa})
- B's changes are not limited by A's ({pb})
- A stays limited until its minute ends
- after waiting Retry-After seconds, A is served again
- the limits dialog refuses 0 reads per minute
- Allowance: 5 reads and 2 changes per minute
- Allowance: 120 reads and 30 changes per minute
