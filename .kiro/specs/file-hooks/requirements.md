# File hooks: requirements (v2, after security, architecture, QA and design reviews)

## Why
Customers bring their own antivirus, OCR or extraction, records system and storage. Today the scan and
the reading of a file are simulated, a browser decides them, and documents registered through the TMF667
API with inline content skip scanning. File hooks let a customer's systems take part in the life of a
file: they are told when something happens to it, and the antivirus and OCR systems answer back.
The same contract is kept in the DXP rebuild (`docs/rebuild/18-tenancy-and-data-protection.md`).

## Scope
In: three new opt-in file events plus the hold flag on the existing change event; scan and extraction
results; a confirm-upload endpoint for `uploadUrl` uploads; an organisation switch for external
processing; per-document processing mode; timeouts; screens, copy and accessibility; docs and tests.
Out: a storage port (the store stays Supabase here), OCR started from the screens.

## Decisions taken in review (D) — the ones marked "to confirm" need the product owner
| Id | Decision |
| --- | --- |
| D1 | External processing is an explicit organisation switch ("Use the organisation's own antivirus", "Use the organisation's own reader"), not inferred from keys. Revoking a scanner never turns simulation back on. **To confirm:** stored in a new tenant column requested from Lovable; until it exists, the switch is "on" once the organisation has ever connected a scanner (revoked included), so the fallback never weakens protection. |
| D2 | Events are written by a database trigger requested from Lovable (atomic with the change, complete for every path). **To confirm:** until it exists, the app writes them right after the guarded update and repairs a missing event on the client's retry (R2.10). |
| D3 | One active scanner and one active reader per organisation; a second is refused while one is active. |
| D4 | `scan` and `extract` are exclusive scopes: a key that has one has no other scope. |
| D5 | Quarantine is per version and permanent; a quarantined version can never be downloaded, restored or made current again. |
| D6 | Hold changes reuse the existing `DocumentChangeEvent` with `legalHold` added to the payload; no new hold event (it would double bulk traffic). |
| D7 | Names: `DocumentFileStoredEvent`, `DocumentFileReadyToReadEvent`, `DocumentFilePurgedEvent`. They are declared extensions, not TMF667 standard events. Doc 18 is aligned to them. |
| D8 | Timeout default `EXTERNAL_RESULT_TIMEOUT_MINUTES = 30`; uploads never confirmed fail after `UPLOAD_CONFIRM_TIMEOUT_HOURS = 24`. **To confirm.** |

## Terms
- **Scanner / reader:** a connected system whose key has only `scan` / only `extract` (D4), and that is the
  organisation's active one (D3).
- **External mode of a document step:** decided once, when the document enters `scanning` or `reading`,
  from the organisation switch (D1), and recorded on the document: `pipeline_detail = { mode, by, since,
  step, attempt }`. Later changes to keys or the switch do not change a document already in a step.
- **Attempt:** a number that grows each time a step starts (first time and every Try again).

## Requirements (EARS)

### R1 Events out
1. WHEN a version's file is confirmed and its SHA-256 is computed by the server THEN the system SHALL emit
   `DocumentFileStoredEvent` { versionId, contentHash (server-computed), sizeBytes, mediaType, attempt }.
2. WHEN a document enters `reading` THEN emit `DocumentFileReadyToReadEvent` { versionId, attempt }.
3. WHEN a legal hold value actually changes THEN the existing `DocumentChangeEvent` SHALL carry
   `legalHold: true|false`. A no-op hold or release emits nothing new. Reason and reference are never sent.
4. WHEN a document is permanently deleted THEN emit `DocumentFilePurgedEvent` { versionIds } listing the
   versions whose file removal succeeded (empty list allowed). The usability-test reset SHALL NOT emit.
5. The three new events SHALL be delivered only to subscriptions whose query names them in `eventType`
   (exact, case-sensitive). Subscriptions with no query, an empty query or other event types SHALL NOT
   receive them.
6. Event payloads SHALL contain only the keys listed in the design whitelist, with the listed types.
7. Events are emitted whether or not external mode is on, and use the existing delivery (per subscriber,
   HMAC signature, retries, dead letter).

### R2 Scan result in
1. A scanner SHALL be able to download the current version only while the document is in `scanning` with
   `mode: external`. Every other key keeps today's rule (409 `contentLocked` while scanning).
2. `POST /document/{id}/attachment/{versionId}/scanResult` with `{ result: "clean"|"infected"|"error",
   contentHash, attempt, engine, threatName? }` and an `Idempotency-Key`. Idempotency is scoped to
   document, version and attempt.
3. Checks, in this order, each refusing with no write: key and scope (401/403); designated scanner of the
   organisation (403 `notDesignatedScanner`); document and version in the key's tenant (404, same body for
   unknown document, other tenant and unknown version); version is current (409 `versionNotCurrent`);
   state is `scanning` with `mode: external` (409 `notScanning`); attempt matches (409 `staleAttempt`);
   `contentHash` equals the server hash (409 `hashMismatch`); for `clean`, this client downloaded this
   version during this attempt (409 `notFetched`).
4. `clean` → `reading` (R1.2); `infected` → `quarantined` { reason: "threat", by, step: "scan" } and the
   version is added to the document's quarantined versions; `error` → `failed` { reason: "scanError",
   step: "scan" }.
5. A quarantined version SHALL never be downloaded, restored or made current again by any key or person (D5).
6. `engine` and `threatName`: at most 64 characters from letters, digits, space and `._:/-`; anything else
   is 400.
7. Every accepted result writes an activity entry naming the system, the result and (only there) the threat
   name. No threat name, file name or value appears in events or logs.
8. A repeated identical result for a version already moved by this client in this attempt answers 200
   with the stored outcome (a scanner whose reply was lost does not loop on 409).
9. Two results racing: exactly one applies (guarded update on state, version and attempt).
10. If the state moved but the event or activity entry was not written (D2 fallback), the client's retry
   SHALL write the missing ones and answer 200.

### R3 Extraction result in
1. A reader SHALL be able to download the current version only while the document is in `reading` with
   `mode: external`.
2. `POST /document/{id}/attachment/{versionId}/extractionResult` with `{ result: "read", attempt, fields:
   [{ name, value, confidence, source? }] }` or `{ result: "unreadable", attempt }`; same check order as
   R2.3 for reader, tenant, version, state `reading`, attempt.
3. Fields are validated as a whole before any write: names must be details of the document's type (exact
   match; unknown names refused with 400 listing them, escaped); no duplicates; value type from the
   specification (text, number, date, enum); text values have control and bidi characters refused and at
   most `MAX_EXTRACTED_VALUE_CHARS = 2000` code points; `confidence` a finite number in [0,1]; `source` a
   plain label `^[\w .:/-]{0,64}$`, never a link; at most `MAX_EXTRACTED_FIELDS = 100`.
4. Accepted fields are stored as `pending` details of that version, marked as coming from the system, with
   the band from confidence (same cut-offs as today). They are never copied into confirmed details before a
   person checks each one; no automatic or bulk acceptance of external values.
5. `read` (even with no fields) → `ready`; `unreadable` → `failed` { reason: "unreadable", step: "read" };
   fields sent with `unreadable` are refused (400).

### R4 Processing mode, confirm upload and timeouts
1. WHILE the organisation switch is off, scan and reading stay simulated exactly as today: the existing
   pipeline tests pass unchanged.
2. WHILE a document step is recorded `mode: external`, the server SHALL refuse simulated advancing of that
   step (`advancePipeline` answers 409 `externalPending` and changes nothing) and answers a "waiting" flag
   so the browser stops its walk.
3. Every pipeline update SHALL be guarded on the expected state, current version and attempt.
4. Try again restarts the step that failed (`pipeline_detail.step`), with a new attempt, and emits that
   step's event again when external. Only people who can edit may try again.
5. API documents with inline content are stored as `uploading`, their version stored, then moved to
   `scanning` (external) or through the simulated scan — never straight to `ready`.
6. `POST /document/{id}/attachment/{versionId}/uploaded` (scope `register`, the system that registered it)
   confirms an `uploadUrl` upload: the server reads the object, computes its SHA-256, compares it with the
   declared hash (409 `hashMismatch`), then moves to `scanning`. The upload ticket stops working at
   confirm.
7. A document whose recorded external step has no result after `EXTERNAL_RESULT_TIMEOUT_MINUTES` from
   `since` moves to `failed` { reason: "noResult", step }, guarded on state, version and attempt; it never
   moves to clean or ready. A document in `uploading` older than `UPLOAD_CONFIRM_TIMEOUT_HOURS` moves to
   `failed` { reason: "noFile" }. The scheduled run does both; a document fails within the timeout plus one
   scheduled interval.
8. Restoring an older version keeps D5; restoring a version that was never quarantined starts the scan again.

### R5 Screens
1. The tag keeps today's label; a line under it says "Waiting for {system}" and "Since {HH:mm}". "{system}"
   is the name recorded in `pipeline_detail.by`, middle-truncated. The "Scan is simulated" tooltip shows
   only for simulated steps.
2. Failure copy depends on reason and step, and Try again depends on reason (not on "already retried"):
   | Reason | Copy | Actions |
   | --- | --- | --- |
   | scanError | "{system} couldn't check this file. Try again." | Try again |
   | noResult, scan | "{system} didn't answer within {N} minutes. Try again." | Try again |
   | noResult, read | "{system} didn't answer within {N} minutes. Try again, or keep the file without reading." | Try again, Keep without reading |
   | unreadable | today's copy | today's actions |
   | noFile | "The file never arrived. Add it again." | Delete (managers) |
   Keep without reading is never offered for a scan step.
3. Quarantined: "{system} found a possible threat in this file. It's blocked: nobody can open or download
   it. To use this document again, add a clean new version." Actions: Report a problem; Delete for managers.
4. While a shown document waits, the page refetches the list (one query, not one per document) every 5 s,
   then every 15 s after 2 minutes, pauses while the tab is hidden and refetches on return. "Check now"
   refetches at once. If refetching fails, "Can't refresh right now" is shown.
5. Each document's state change is announced once in a polite status region ("Report.pdf: ready");
   quarantine and failures use an alert. Focus never moves.
6. Admin > Connected systems:
   - permission labels: `scan` "Check files for threats and report the result"; `extract` "Read details
     from files and report what it found"; both listed last and never in default permissions;
   - the organisation switch with its effect and its way back: "Files wait for your own antivirus. The
     built-in check stops. If it doesn't answer within {N} minutes, files fail and can be tried again.";
     turning it on needs the confirmation "I understand files will wait for this system"; turning it off
     warns "Files will use the built-in check again: protection is weaker." and is recorded in the
     organisation's activity;
   - disconnecting the active scanner says what happens to files already waiting (they fail after {N}
     minutes) and that new files wait until another scanner is connected (D1);
   - the name field explains "People see this name when a file waits for this system or is blocked by it".
7. Copy passes `eds-terminology.test.ts`; zero axe violations per state in light and dark; a person checks
   the announcements with a screen reader before release.

### R6 Security and data protection
1. Every callback and download is pinned to the key's tenant, including version lookups.
2. D3 and D4 are enforced at key creation and again on every call. Creating a scanner or reader key is for
   administrators only and recorded.
3. Callbacks count against the key's write limit; a 429 never changes a document.
4. Extracted values, threat names and file names never appear in events or logs (tested by spying on logs).
5. An alert-level log line (no values) is written when one key quarantines more than
   `QUARANTINE_ALERT_PER_HOUR` documents in an hour.
6. Residual risk, stated in the docs: a compromised or wrong scanner cannot be told apart from a correct one;
   the controls limit what it can do. A human security review approves before publishing; a privacy (and AI,
   if the reader is AI) impact assessment is flagged for the customer.
