# Telco Docs Compass

Document management for telecom operators: every document belongs to a business record (an account, an order, a ticket), moves along a reviewed status path, and is visible only to the people and organisations it should be. Other systems (order care, ticketing, CRM, CPQ) work with the same documents through a TM Forum Document Management API (TMF667).

This is a prototype with synthetic data and no guarantee of security, compliance or availability. It was built with [Lovable](https://lovable.dev) and is kept in sync with it. Live app: https://telco-docs-compass.lovable.app

Stack: TanStack Start (React 19, TanStack Router and Query), Supabase (Postgres with row-level security, Auth, Storage), Tailwind 4, zod, Vitest. Package manager: bun.

## First day

```sh
bun install
bun run dev        # prints the local URL
bun run check      # lint + types + tests + build; run it before every commit
```

1. Read `docs/architecture/ARCHITECTURE.md`. It has the map of the code and a table "I want to change X, where do I look?".
2. Open a screen, for example `src/routes/_authenticated/documents.tsx`, and follow the call: screen, hook in `src/hooks`, `src/services/api.ts`, a server function in `src/services/*.functions.ts`.
3. Find a business rule and its test: rules are plain functions such as `src/services/document-rules.ts`, tested in `src/services/__tests__`.
4. Make a small change, run `bun run check`, and read `AGENTS.md` before your first commit. Skip its first block (it is Lovable's); the rules start at "Project rules", and "Repository rules" is at the end.

Security rules are in `docs/architecture/security-baseline.md` and accessibility rules in `docs/architecture/accessibility.md`.
Signing in needs one of the demo accounts of the connected Supabase project. Ask the repository owner (see `.github/CODEOWNERS`).

## Configuration

The variable names are in `.env.example`. Lovable manages the real `.env`; it only holds public project settings. Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_CRON_SECRET`) are set as secrets in the hosting environment and never go in the repository or in browser code.

## Tests

| Command | What it runs | Needs |
| --- | --- | --- |
| `bun run check` | eslint, `tsc`, all unit tests, build | nothing |
| `bun run test` | unit tests only | nothing |
| `RUN_ACCESS_TESTS=1 bun run test` | also signs in as demo users and checks what access rules allow (read only) | `.env` and network |
| `python3 e2e/tmf-api.py` and the other `e2e/*.py` | TMF API, events, rate limits, sharing, against a running app | a running app, a browser, network; they create "TMF test" data (clean it with Admin > Reset test data) |

There is no CI: `bun run check` is the gate. Unit tests run offline. Service tests use an in-memory stand-in for the Supabase client (`src/test/fake-db.ts`). It proves the application's own checks, not what the database enforces; row-level security is covered by the opt-in access tests.

## Glossary

- **Tenant**: an organisation that owns data. A group has countries below it. Every row belongs to one tenant. **Master tenant**: the one that sets global floors, such as the minimum retention.
- **Record (entity)**: the business object a document belongs to (account, order, ticket).
- **Grant**: permission given to a person or another organisation on one document, such as "Shared with me".
- **Legal hold**: blocks deletion and expiry of a document until released.
- **Four-eyes**: the person who added a document cannot approve it.
- **Idempotency key**: a value the caller sends with a change so that sending the same change twice has the effect of once.
- **Append-only / immutable**: rows that are only ever added, never changed or deleted (versions, the activity log). **Tombstone**: what is left of a permanently deleted document, so the log still makes sense.
- **Sensitivity**: a label on a document (public, internal, confidential, restricted). It is a label, not an access rule.
- **ERAD**: the name of this app's design system (`src/components/erad`).
- **TMF667**: the TM Forum Document Management API; **TMF630** are its REST design guidelines.
- **Seam**: the typed boundary between a screen and the server. It returns `SeamResult` (`{ ok, data }` or `{ ok: false, error }`) instead of throwing.
- **Outbox**: the table of events waiting to be delivered. **Fan-out**: copying each event into one delivery per subscriber. **Dead-letter**: a delivery that used up all its attempts.
- **Claim / lease**: reserving a piece of work so only one worker runs it, and the time limit on that reservation.
- **RLS**: row-level security in Postgres; the database itself decides which rows a person can read.
- **CTK**: the TM Forum conformance test kit. This project has not run it.

## Where things are

| Path | What lives there |
| --- | --- |
| `src/routes` | Pages (file-based routing) and the public API routes under `api/public` |
| `src/components` | UI. `erad/` are the design-system primitives, `ui/` is generated shadcn |
| `src/services` | Server functions, pure business rules, the TMF gateway, background workers |
| `src/integrations/supabase` | Generated Supabase clients and types. Do not edit by hand |
| `contracts` | OpenAPI and JSON schemas of the document model and the TMF667 API |
| `drizzle` | Database migrations. Lovable manages them: do not edit by hand |
| `docs` | `architecture/` (how it works), `decisions/` (why), `rebuild/` (plan for a later Java rebuild) |
| `e2e` | End-to-end scripts for the API |

## Working with Kiro or another AI assistant

The assistant reads `AGENTS.md` and `.kiro/steering/`. `.kiro/steering/invariants.md` lists what it must never break. Ask for small changes with a clear check ("add X; `bun run check` must pass; add a test that fails without it"), and ask it to say what it verified and what it could not.

## Built with Lovable

Changes made in the Lovable editor are committed to this repository, and pushes to `main` sync back to Lovable. Do not rewrite published history.
