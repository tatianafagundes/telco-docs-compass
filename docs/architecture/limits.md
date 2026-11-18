# Limits

Every number that bounds what a caller, a job or a page can do, with why it has that value. Each
row is checked by `src/test/limits-doc.test.ts`: if a value changes in code, this table must change
with it (and the reason must still hold).

| Constant | Value | File | Why |
| --- | --- | --- | --- |
| `MAX_BODY_CHARS` | 50000 | `gateway-core.ts` | An ordinary API body is a few fields; this leaves room without letting a caller fill memory. |
| `MAX_INLINE_BYTES` | 5242880 | `gateway-create-input.ts` | 5 MB of inline base64 file. Larger files are sent by address or uploaded. |
| `MAX_URL_FETCH_BYTES` | 26214400 | `gateway-fetch.ts` | 25 MB for a file the gateway fetches from an address. |
| `URL_FETCH_TIMEOUT_MS` | 15000 | `gateway-fetch.ts` | A slow address must not hold a request open. |
| `TOKEN_REQUEST_MAX_BYTES` | 4000 | `gateway-token.ts` | A token request is a few form fields. |
| `TOKEN_TTL_SECONDS` | 900 | `gateway-token.ts` | Short-lived tokens limit what a leaked one can do. |
| `TOKEN_REQUESTS_PER_ADDRESS_PER_MINUTE` | 10 | `gateway-token.ts` | Stops guessing keys from one address. |
| `TOKEN_REQUESTS_PER_SYSTEM_PER_MINUTE` | 20 | `gateway-token.ts` | One system needs a token every 15 minutes, not dozens. |
| `MAX_ACTIVE_TOKENS` | 10 | `gateway-token.ts` | A system should reuse its token until it expires. |
| `MAX_LIMIT` | 100 | `tmf667-shared.ts` | Largest API page. |
| `DEFAULT_LIMIT` | 20 | `tmf667-shared.ts` | API page when none is asked for. |
| `RELATED_FILTER_MAX` | 1000 | `gateway-list-filter.ts` | Past this, a record filter is refused rather than answered incompletely. |
| `KEY_LIFETIME_DAYS` | 365 | `integration-clients.functions.ts` | System keys are rotated at least yearly. |
| `IDEMPOTENCY_TTL_HOURS` | 24 | `document-rules.ts` | A retried request is recognised for a day. |
| `CLAIM_STALE_SECONDS` | 300 | `idempotency-claim.ts` | A request that has not answered in 5 minutes has died; its key may be taken over. |
| `PREVIEW_URL_SECONDS` | 300 | `document-rules.ts` | A preview link is used at once. |
| `DOWNLOAD_URL_SECONDS` | 60 | `document-rules.ts` | A download link is used at once and should not be passed around. |
| `UPLOAD_URL_SECONDS` | 7200 | `document-rules.ts` | Fixed by storage; shown to the person uploading. |
| `WINDOW_SECONDS` | 60 | `rate-limit-rules.ts` | API allowances are per minute. |
| `LIMITER_MAX_KEYS` | 1000 | `rate-limit-rules.ts` | In-memory counters stay bounded under a flood of new keys. |
| `ACCESS_DENIED_LOGGED_PER_MINUTE` | 20 | `seam-runtime.ts` | Refused attempts are logged without letting anyone flood the log. |
| `PAGE_SIZE` | 50 | `search-rules.ts` | Search results per page. |
| `COUNT_CAP` | 10000 | `search-rules.ts` | Counting stops here so a broad search stays fast ("10,000+"). |
| `BULK_LIMIT` | 10000 | `search-rules.ts` | Most documents one bulk change may touch. |
| `BULK_BATCH` | 200 | `search-rules.ts` | Documents changed per pass, so one pass fits in a request. |
| `BULK_LEASE_SECONDS` | 600 | `search-rules.ts` | A pass that has not finished in 10 minutes has died; the job is failed. |
| `JOBS_PER_PASS` | 5 | `bulk-worker.ts` | Waiting jobs advanced per pass. |
| `HELD_JOBS_CHECKED` | 20 | `bulk-worker.ts` | Running jobs checked for an expired lease per pass. |
| `BULK_ROUNDS_PER_CALL` | 3 | `scheduled-run.ts` | Passes per scheduler call: moves large jobs without hitting the request time limit. |
| `EXPIRE_BATCH` | 500 | `maintenance.ts` | Documents expired per run; a backlog clears over a few minutes. |
| `EXPIRY_FALLBACK_INTERVAL_MS` | 60000 | `expiry-fallback.ts` | Expiry from a read runs at most once a minute per tenant. |
| `MAX_TENANTS` | 1000 | `expiry-fallback.ts` | The once-a-minute memory stays bounded. |
| `FAN_OUT_BATCH` | 200 | `tmf-events.ts` | Events turned into deliveries per pass. |
| `DELIVERY_BATCH` | 20 | `event-delivery-rules.ts` | Deliveries sent per pass; with the timeout it fits in the lock. |
| `DELIVERY_TIMEOUT_MS` | 5000 | `event-delivery-rules.ts` | A slow receiver must not hold the pass. |
| `DELIVERY_LOCK_SECONDS` | 300 | `event-delivery-rules.ts` | A claimed delivery is retried by another pass after this. |
| `MAX_ATTEMPTS` | 6 | `event-delivery-rules.ts` | First try plus five retries, then given up (dead letter). |
| `MAX_RETRY_AFTER_SECONDS` | 3600 | `event-delivery-rules.ts` | A receiver's Retry-After is honoured up to an hour. |
| `DNS_LOOKUP_TIMEOUT_MS` | 3000 | `event-delivery-rules.ts` | The address check must not hold a request. |
| `SIGNATURE_TOLERANCE_SECONDS` | 300 | `tmf667-security.ts` | A receiver refuses a signed event older than 5 minutes (replay). |
