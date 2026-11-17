# Keep the handbook's copies, and check them

`docs/rebuild/` is a handbook for rebuilding the app on another stack. It is written to be handed over as one folder, so it carries copies of the contracts, the migrations, and the reference rules and tests, and its own documents link to them with paths relative to the folder.

Measured on 2026-11-17 against the original `main`: the contracts and the 15 migrations the handbook had were byte-identical to their sources (there are 16 now; the newest was missing from the copy). The reference rules and tests were identical except for two rules and four tests. The two rules were behind the app: the "approved content is protected" rule (`contentProtected`, `metadataPatchAllowed`, `contentEditState`) had been added to the app and not to the copies, so a port made from them would miss it. The two integration tests differ on purpose, to keep the demo password out of the handbook.

Deleting the copies would have broken the handbook as a stand-alone pack. Leaving them would have let them go stale again, since nothing runs on a schedule here. So:

- `scripts/sync-rebuild.mjs` (`bun run sync:rebuild`) refreshes every copy from its source.
- `src/test/repo-hygiene.test.ts` runs it in `--check` mode, so `bun run check` fails when a copy is out of date and says how to fix it.
- The sanitised integration tests are never overwritten.

Cost: a change to a bundled rule, test, migration or contract also changes its copy in the same commit. That is intended: the handbook describes the app as it is.

Not decided here: whether the handbook's numbered business rules (`03-business-rules.md`) and the traceability table need new rows for recent changes. That is tracked as its own task.
