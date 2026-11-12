# 14 — Non-functional requirements

## Limits found in the code
| Limit | Value | Source |
|---|---|---|
| Preview / download link lifetime | 300 s / 60 s | document-rules.ts |
| Idempotency key lifetime | 24 h | document-rules.ts |
| Search page size / count cap | 50 / 10,000 (+1) | search-rules.ts |
| Bulk limit / batch | 10,000 / 200 | search-rules.ts |
| Activity / people page | 20 | review-rules.ts |
| Search text | ≤ 200 characters | search-rules.ts |
| Document name | 1–255 characters | schema |
| API page | default 20, max 100 | tmf667-mapper.ts |
| API inline / URL attachment | 5 MB / 25 MB | tmf-gateway.ts |
| API limits per system | 120 reads, 30 changes / min (bounds 1–6000 and 1–1000) | rate-limit-rules.ts |
| Key / OAuth token lifetime | 365 days / 15 min | integration-clients.functions.ts, tmf-gateway.ts |
| Event retries | 6 attempts; 30 s, 2 min, 10 min, 30 min, 2 h; Retry-After ≤ 1 h | event-delivery-rules.ts |
| Event signature tolerance | 300 s | tmf667-mapper.ts |
| Legacy API sunset | 10 May 2027 | tmf-gateway.ts |
| Per-type file size and types | from the document type definition (maxSizeMb, acceptedMimeTypes) | document_specifications |

## Quality targets
- **Accessibility:** WCAG 2.2 AA, including:
  - keyboard paths for every action, focus return after dialogs, and 24 px targets
  - use at 200% zoom (720 CSS px on a 1440 screen), light and dark themes; `prefers-reduced-motion` honoured
  - every text at 4.5:1 and every UI element at 3:1 in both themes, on idle, hover and selected states (the reference has five failing token pairs, listed in 13)
  - layouts at 792 px width and on phones
- **Privacy:**
  - No document content or detail values in logs, events or audit.
  - Personal names are visible only inside the tenant.
  - Deleting a person's account keeps the documents (creator is set to null).
- **Security:** see `04-security-and-tenancy.md`. Also:
  - OWASP ASVS L2
  - secrets only in the vault
  - restricted CORS
  - no `*` origins
- **Observability:**
  - Structured JSON logs with `requestId`, client and tenant on each API call, and no content.
  - Metrics: rate-limit hits, delivery attempts, give-ups, pipeline failures and search latency.
  - Traces across API → Cassandra → OpenSearch.
- **Availability and data:**
  - Cassandra RF=3 per DC, with LOCAL_QUORUM for writes and for reads that need it.
  - OpenSearch can be rebuilt from Cassandra at any time.
  - Object storage is versioned.
- **Retention:**
  - Effective retention is at least the group floor.
  - Legal hold overrides everything.
  - Permanent deletion leaves a tombstone.
- **Scale:** 5M+ documents per tenant, 100+ connected systems, and event fan-out of more than 1k/min.
