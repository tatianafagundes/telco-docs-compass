# No CI: `bun run check` is the gate

The team decided not to run CI for this project. The gate is one local command, `bun run check` (eslint, `tsc`, all unit tests, build). It must pass before every commit.

Because nothing else will notice a slip, rules that would normally live in CI are tests: `src/test/repo-hygiene.test.ts` enforces the file size cap, that docs point at real files, the module README sections and English-only text.

Opt-in checks stay opt-in and are run by hand before touching access, the TMF gateway or event delivery: `RUN_ACCESS_TESTS=1 bun run test` and the scripts in `e2e/`.

Risk: forgetting to run it. A local `pre-commit` hook that calls `bun run check` is possible and optional; the team has not asked for it.
