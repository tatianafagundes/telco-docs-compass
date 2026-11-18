# Split `src/services` by domain, with one place for each business rule

Context: three files hold most of the server logic (`tmf-gateway.ts` 1,379 lines, `document-write.functions.ts` 879, `tmf667-mapper.ts` 734). The same business rule (hold, status change, delete) is applied at three entry points: the server functions, the TMF gateway and the bulk worker. For maintainability each rule should be written once.

Decision: split by domain into `document/`, `access/`, `review/`, `retention/`, `search/` and `tmf/`, each with a README and a comment at the top of each file. Put hold, approval and sensitivity changes in one module (`shared/document-commands.ts`) that all three entry points call. Old file names stay as one-line re-exports while imports move, so nothing breaks half way. Keep the `.functions.ts` suffix.

Order: first the tests that pin today's behaviour (gateway characterisation and a parity test across the three entry points), then move code. A fix and a move never share a commit.

Consequences: more, smaller files; for a while two import paths exist. The 300-line cap in `src/test/repo-hygiene.test.ts` keeps the result from growing back. A later Java rebuild ports module by module.

Outcome (2026-11-17): done, with a flat folder instead of sub-folders, so the routes and Lovable keep their import paths.
- `tmf-gateway.ts` names `gateway-core`, `-idempotency`, `-reads`, `-create`, `-patch`, `-changes`, `-hub`, `-routing`, `-token`, `-body`, `-fetch`, `-reply`, `-list-filter`, `-create-input`.
- `document-write.functions.ts` names `document-read`, `-content`, `-status`, `-review`, `-access`.
- `tmf667-mapper.ts` names `tmf667-shared`, `-document`, `-specification`, `-events`, `-security`.
- No file in `src/services` is over 300 lines.
- One place per rule: `document-approval.ts` (approval gate), `holdColumns`, `deleteIfAllowed`, `retentionHolds`, `typeRefusal`. A single "commands" module was not built: the three entry points differ on purpose in who the actor is, how the activity entry reads and what they answer, and no rule is left written twice. The parity test (`rule-parity.test.ts`) checks the screens' rules against the API and bulk changes.
