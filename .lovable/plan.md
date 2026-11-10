# Opening document management to other systems (TMF Open APIs)

## Short answer: not yet
The app's business rules are ready (statuses, approval gate, holds, retention, access, detail review, country isolation, audit) and are described in a TMF667-style contract. But today they can only be used **from inside the app's own screens**. Nothing is reachable by Order care, Ticket management, CRM or CPQ yet:
- No external web addresses (API endpoints) exist.
- No way for a system (rather than a person) to sign in and act for a country.
- No notifications to other systems when something changes (TMF event hub).
- Some data names follow our internal contract, not exactly the TMF667 resource shape (`relatedEntity`, `attachment`, `@type`, `href`, filtering, field selection).

## Perspectives
- **Customer / integrator:** one predictable API per TMF standard, sandbox data, clear errors, examples per system (Order, Ticket, CRM, CPQ).
- **Architecture:** TMF667 Document and DocumentSpecification as the core; other systems link by `relatedEntity` (`@referredType` ProductOrder, TroubleTicket, Customer, BillingAccount, Quote). No copying of their data.
- **Security and compliance:** per-system credentials scoped to one country and a list of permissions; every call audited with the calling system; country isolation and legal hold enforced identically to the screens; no record names leak through shared links.
- **Operations:** versioned base path, rate limits, idempotency keys, health check, request IDs in every reply.
- **Telecom domain:** align to TMF630 (REST guidelines), TMF667 (Document), TMF688 (Event), TMF672 (permissions vocabulary), and the referred-entity APIs: TMF622 Product Order, TMF621 Trouble Ticket, TMF629 Customer, TMF666 Account, TMF648 Quote.
- **Product:** the north star depends on it: systems must always get the current approved version for an order or contract in one call.

## What we build (in order)

### Phase 1 — TMF667 read API (safe first step)
- `GET /tmf-api/documentManagement/v4/document` with TMF filters: `relatedEntity.id`, `relatedEntity.@referredType`, `documentType`, `lifecycleState`, `fields`, `offset`/`limit`, `X-Total-Count`.
- `GET .../document/{id}` with versions as `attachment` entries and a short-lived download link.
- `GET .../documentSpecification` and `/{id}`.
- Convenience for the north star: `GET .../document?relatedEntity.id=O-7731&lifecycleState=approved,effective` returns the current approved document per type.

### Phase 2 — System access
- Admin screen "Connected systems": add a system (Order care, Ticket, CRM, CPQ), choose country and permissions (read, register, transition, hold), show the key once, rotate or revoke.
- Every call records the system as the actor in Activity.

### Phase 3 — TMF667 write API
- `POST .../document` (register, with `relatedEntity` and upload link), `PATCH .../document/{id}` (TMF merge-patch for allowed fields), `POST .../document/{id}/attachment` (new version).
- Lifecycle via task resources: `.../document/{id}/transition`, `.../legalHold`, `.../access`. Same rules and reasons as the screens (approve gate, hold blocks delete, frozen statuses).
- Idempotency header required on every write.

### Phase 4 — Events (TMF688 pattern)
- `POST/DELETE .../hub` for systems to subscribe with a callback address.
- Events: `DocumentCreateEvent`, `DocumentStateChangeEvent` (e.g. approved, effective, expired), `DocumentAttributeValueChangeEvent`, `DocumentDeleteEvent`. Signed, retried, never include document content.

### Phase 5 — Integration packs
For each system, a one-page guide plus a test script:
- **Order care (TMF622):** fetch the approved contract and order attachments for an order; react to state change.
- **Ticket management (TMF621):** attach evidence to a ticket; read-only access by ticket.
- **CRM (TMF629/666):** KYC outcome and customer documents per account, with personal-data sensitivity.
- **CPQ (TMF648):** register the quote document, send for review, receive "approved".

## How we prove it
- Contract tests checking every reply against the TMF667 schema.
- Isolation tests per system key (Sweden key cannot read Norway; revoked key fails at once).
- Re-run the existing share and country isolation tests.
- Published OpenAPI file and examples in Files.

## Open decisions for you
1. Which system first? (Suggestion: Order care read access, it serves the north star directly.)
2. TMF667 version: v4 (widest support today) or v5.
3. System sign-in: API keys managed in the app (simplest), or OAuth client credentials if your systems need it.

## Technical details
- Server routes under `src/routes/api/public/tmf-api/documentManagement/v4/*` (public prefix, so each handler verifies the system key itself, hashed in a new `integration_clients` table with tenant, scopes, revoked_at).
- Handlers reuse the existing pure rules (`document-rules`, `document-actions`, `review-rules`, `tenant-rules`) and write paths; a mapping layer `src/services/tmf667-mapper.ts` (tested) converts between our model and TMF resources (`@type`, `@baseType`, `href`, `relatedEntity`, `attachment`, `characteristic`).
- Reads run through a security-definer function scoped to the key's tenant and scopes, never the admin client unchecked.
- Events: `event_subscriptions` and `event_outbox` tables; a scheduled route delivers with HMAC signature and retries.
- Rate limits and request size limits per key; errors in the TMF630 error shape (`code`, `reason`, `message`, `status`).
- Contract file: `contracts/seams/tmf667-document.openapi.yaml`.
