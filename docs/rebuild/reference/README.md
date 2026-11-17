# Reference code and contracts

This handbook is meant to be handed over as one folder, so it carries its own copies of the code and contracts it describes. They are copies: edit the sources, not these files.

| Folder here | Source of truth | Notes |
| --- | --- | --- |
| `rules/` | `src/services/<same name>` | The pure business rules the Java rebuild ports |
| `rule-tests/` | `src/services/__tests__/<same name>` | The tests that define the expected values. The two `*.integration.test.ts` files are edited on purpose: the demo password is read from the environment, so none is stored here |
| `postgres-schema/` | `drizzle/migrations/*.sql` | The database definition, including row-level security policies |
| `../contracts/` | `contracts/` | JSON schemas and the OpenAPI files |

The code here is for reading and porting: it imports `@/...` paths that only exist in the app, so it does not compile on its own. The two `*.integration.test.ts` files are never overwritten, so a change in their sources is not detected. Anything added by hand to `contracts/` or `postgres-schema/` here is deleted by the sync.\n\nTo refresh them after a change in a source: `bun run sync:rebuild`. `bun run check` fails when a copy is out of date, so the files already here cannot drift quietly. A new `*-rules.ts` in `src/services` is reported too, until you copy it here once. `original-briefs/` and `design/` are not copies and are not touched.

See `docs/decisions/2026-11-17-keep-handbook-copies-in-sync.md` for why they exist.
