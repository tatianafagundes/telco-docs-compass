# Testing the TMF667 API from several angles

## Goal
Show that connected systems (Order care, Ticket management, CRM, CPQ) can rely on the API. The tests cover security, TMF conformance, business rules, reliability and the integrator experience. The result is a repeatable test script plus a short report.

## Perspectives and what each checks

### 1. Integrator (Order care, Ticket, CRM, CPQ journeys)
- **Order care:** fetch the current approved contract for O-7731 in one call, then download its file.
- **CPQ:** register a quote, send it for review, and confirm approval is refused while details are unconfirmed.
- **Ticket management:** attach evidence to a ticket record, then list documents by ticket.
- **CRM:** list customer and account documents, and confirm sensitivity is shown.

### 2. TMF conformance (TMF630 / TMF667 / TMF688)
- Every reply matches our TMF667 description: `id`, `href`, `@type`, `relatedEntity`, `attachment` and `lifecycleState`.
- Paging works: `offset`/`limit`, `X-Total-Count` and `X-Result-Count`. A limit above 100 is reduced to 100.
- `fields` selection always keeps `id`, `href` and `@type`.
- Errors use the TMF shape (`code`, `reason`, `message`, `status`) with the right HTTP status.
- `href` links resolve.

### 3. Security and isolation
- Requests with a missing, malformed, fake or revoked key are refused (401).
- Each permission is enforced: a read-only key can't add, change status, hold or subscribe (403).
- A Sweden key gets "not found" for a Norway document, and Norway filters return nothing.
- A Sweden key never sees Norway names or ids in any reply.
- Bad input is refused: oversized bodies, invalid JSON, non-UUID ids, injection-style filter values, and callback addresses that are internal or http-only.
- Signed download links expire after 60 seconds.

### 4. Business rules (same as the screens)
- Skipping a status step is refused, and frozen documents can't be edited.
- Approval needs the approve permission and every required detail confirmed.
- Placing a hold needs a reason. Hold and status changes appear in activity as "via <system>".

### 5. Reliability
- Repeating a change with the same request key and body does not apply it twice.
- Reusing that key with a different body is refused (409).
- A write without a request key is refused (400).
- Event delivery: subscribe a test receiver, make a status change, then check the event arrives signed with the correct HMAC and with no document content. A failing receiver is retried, up to 5 times.

### 6. Performance (light)
- Time list, get and filter calls (target: first page under 500 ms on current data).
- Note which calls slow down at scale. A full million-document test still needs a separate test database.

## Deliverables
- `e2e/tmf-api.py`: repeatable, exits 1 on any failure.
  - Creates its own system keys through the admin screen, then disconnects them at the end.
  - Labels every document it creates for easy cleanup.
- An event receiver for the delivery test: a short-lived public test URL. If outbound delivery to the sandbox isn't possible, the delivery logic is tested directly.
- A PDF report in Files covering each perspective: pass or fail, evidence, and any fixes.
- Any defects found are fixed in the same pass and re-tested.

## Technical details
- Uses the Sweden admin to mint keys with different permissions (read-only, full).
- Norway isolation uses seeded Norway document ids, since there is no Norway admin.
- Response bodies are scanned for Norway-specific strings.
- Signature check recomputes HMAC-SHA256 over the raw body with the subscription's signing secret.
- Test documents are created on order O-7731 with a "TMF test" name prefix. "Reset test data" removes them.
