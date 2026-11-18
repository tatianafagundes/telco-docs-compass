# Telco Docs Compass

Document management for telecom operators. Every document belongs to a business record (an account, an order, a ticket), moves along a reviewed status path, and is visible only to the people and organisations it should be. Other systems (order care, ticketing, CRM, CPQ) work with the same documents through a TM Forum Document Management API (TMF667).

This is a prototype with synthetic data and no guarantee of security, compliance or availability. It was built with [Lovable](https://lovable.dev) and is kept in sync with it. Live app: https://telco-docs-compass.lovable.app

## What it does

- **Documents on records.** People add files to a record, check the details read from them, and move them through `draft`, `in_review`, `approved`, `effective`, then `superseded` or `expired`, then `archived`.
- **Review with four-eyes.** The person who added a document cannot approve it. Approval needs the required details to be confirmed.
- **Retention and legal holds.** A hold blocks deletion and expiry. Deletion respects the retention date of the document type and a minimum set by the group. Permanent deletion leaves a tombstone so the activity log still makes sense.
- **Organisations.** A group (for example a holding) has country organisations below it. Each organisation sees only its own data. The group sets shared document types and minimums, and sees counts, never content. Documents can be shared with a person or another organisation.
- **Search and bulk changes** across thousands of documents, with the same access rules as a single change.
- **An API for other systems** (TMF667 v4) with system keys, OAuth tokens, rate limits per system and change events delivered to subscribers.
- **An activity log** that is append-only and written by every change.

Who uses it: people at an operator who handle contracts, orders and tickets (viewer, contributor, reviewer, manager), the organisation's admin (`tenant_admin`) and the group admin (`master_admin`). The roles are explained in `docs/architecture/ARCHITECTURE.md`.

## Stack

TanStack Start (React 19, TanStack Router and Query, server functions), Vite, Tailwind 4, zod, Vitest. Backend: Supabase (Postgres with row-level security, Auth, Storage). Hosting: Lovable, which builds for Cloudflare Workers. Package manager: bun.

## Quick start

```sh
bun install
bun run dev        # prints the local URL
bun run check      # lint + types + tests + build; run it before every commit
```

The real `.env` is managed by Lovable and holds only public project settings (names in `.env.example`). Signing in needs a demo account of the connected Supabase project: ask the repository owner (see `.github/CODEOWNERS`). Without the server-side key, a local server can read but cannot run privileged writes; those are checked on the preview (`docs/operations/regression-after-publish.md`).

## Documentation

Read in this order when you are new:

| Document | What you get from it |
| --- | --- |
| `docs/architecture/ARCHITECTURE.md` | The system: context, runtime pieces, how reads, writes, the API, events and scheduled work travel, the data and access model, and known limits |
| `docs/architecture/code-organization.md` | Where the code is, how files are named, the layers, and where a change goes ("I want to change X") |
| `docs/development.md` | Setting up, the gate, tests, and recipes for a new screen, server function, rule, API endpoint or scheduled task, with the pitfalls |
| `docs/operations/deployment.md` | How the app is built, hosted, configured and published today, and what changes for an internal environment |
| `docs/operations/runbook.md` | Running and checking the app: the scheduled job, failed bulk jobs, given-up event deliveries, connected systems |
| `docs/operations/regression-after-publish.md` | What to check on the preview after a change reaches `main` |
| `docs/architecture/security-baseline.md`, `docs/architecture/accessibility.md`, `docs/architecture/limits.md` | Security controls, accessibility rules, every limit and why |
| `.kiro/steering/invariants.md` | The rules no change may break |
| `docs/decisions/` | One short file per decision, with its reason |
| `docs/integration/tmf667-api.md`, `docs/integration/tmf667-conformance.md` | For a team connecting another system: keys, tokens, endpoints, idempotency, events and their signature, errors; how the API compares with the official TMF667 v4 definition |
| `src/services/README.md`, `src/routes/api/public/tmf-api/AGENTS.md` | The server logic and the public API, in detail |
| `AGENTS.md` | Project and repository rules for people and AI assistants |
| `roadmap.md` | What is open |
| `docs/rebuild/` | A handbook for a later rebuild in Java; not needed to work on this code |

## Tests

| Command | What it runs | Needs |
| --- | --- | --- |
| `bun run check` | eslint, `tsc`, all unit tests, build | nothing |
| `bun run test` | unit tests only | nothing |
| `RUN_ACCESS_TESTS=1 bun run test` | also signs in as demo users and checks what access rules allow (read only) | `.env` and network |
| `python3 e2e/tmf-api.py` and the other `e2e/*.py` | TMF API, events, rate limits, sharing, against a running app | a running app with the server-side key, a browser, network; they create "TMF test" data (clean it with Admin > Reset test data) |

There is no CI: `bun run check` is the gate. Unit tests run offline. Service tests use an in-memory stand-in for the Supabase client (`src/test/fake-db.ts`). It proves the application's own checks, not what the database enforces; row-level security is covered by the opt-in access tests.

## Glossary

- **Tenant**: an organisation that owns data. A group has countries below it. Every row belongs to one tenant. **Master tenant**: the one that sets global floors, such as the minimum retention.
- **Record (entity)**: the business object a document belongs to (account, order, ticket).
- **Document type (specification)**: what kind of document it is, which details it must have, which file types it accepts and how long it is kept.
- **Grant**: permission given to a person or another organisation on one document, such as "Shared with me".
- **Legal hold**: blocks deletion and expiry of a document until released.
- **Four-eyes**: the person who added a document cannot approve it.
- **Idempotency key**: a value the caller sends with a change so that sending the same change twice has the effect of once.
- **Append-only / immutable**: rows that are only ever added, never changed or deleted (versions, the activity log). **Tombstone**: what is left of a permanently deleted document, so the log still makes sense.
- **Sensitivity**: a label on a document (public, internal, confidential, restricted). It is a label, not an access rule.
- **ERAD**: the name of this app's design system (`src/components/erad`).
- **TMF667**: the TM Forum Document Management API; **TMF630** are its REST design guidelines.
- **Seam**: the typed boundary between a screen and the server. It returns `SeamResult` (`{ ok, data }` or `{ ok: false, error }`) instead of throwing.
- **Server function**: a function that runs on the server and is called from the browser like a normal function (TanStack Start `createServerFn`).
- **Outbox**: the table of events waiting to be delivered. **Fan-out**: copying each event into one delivery per subscriber. **Dead-letter**: a delivery that used up all its attempts.
- **Claim / lease**: reserving a piece of work so only one worker runs it, and the time limit on that reservation.
- **RLS**: row-level security in Postgres; the database itself decides which rows a person can read.
- **Service role**: the privileged Supabase key that bypasses RLS. Only server code uses it, after its own checks.
- **CTK**: the TM Forum conformance test kit. This project has not run it.

## Working with Kiro or another AI assistant

The assistant reads `AGENTS.md` and `.kiro/steering/`. `.kiro/steering/invariants.md` lists what it must never break. Ask for small changes with a clear check ("add X; `bun run check` must pass; add a test that fails without it"), and ask it to say what it verified and what it could not.

## Built with Lovable

Changes made in the Lovable editor are committed to this repository, and pushes to `main` sync back to Lovable. Do not rewrite published history. Lovable owns the database schema and the generated files; see the first block of `AGENTS.md`.
