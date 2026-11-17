# Split `src/services` by domain, with one place for each business rule (proposed)

Context: three files hold most of the server logic (`tmf-gateway.ts` 1,379 lines, `document-write.functions.ts` 879, `tmf667-mapper.ts` 734). The same business rule (hold, status change, delete) is applied at three entry points: the server functions, the TMF gateway and the bulk worker. For maintainability each rule should be written once.

Decision: split by domain into `document/`, `access/`, `review/`, `retention/`, `search/` and `tmf/`, each with a README and a comment at the top of each file. Put hold, approval and sensitivity changes in one module (`shared/document-commands.ts`) that all three entry points call. Old file names stay as one-line re-exports while imports move, so nothing breaks half way. Keep the `.functions.ts` suffix.

Order: first the tests that pin today's behaviour (gateway characterisation and a parity test across the three entry points), then move code. A fix and a move never share a commit.

Consequences: more, smaller files; for a while two import paths exist. The 300-line cap in `src/test/repo-hygiene.test.ts` keeps the result from growing back. A later Java rebuild ports module by module.
