# Code organisation

Where the code is, how it is named, which layer may call which, and where a change goes. How the pieces work together at runtime is in `docs/architecture/ARCHITECTURE.md`.

## Top level

| Path | What lives there | Who edits it |
| --- | --- | --- |
| `src/` | The app: pages, components, hooks, server code, tests | us |
| `contracts/` | `model/`: JSON Schemas of the document model. `seams/`: OpenAPI of the screen seam (`document.openapi.yaml`) and of the public API (`tmf667-document.openapi.yaml`) | us, with the code that implements them |
| `public/` | Static files, including `tmf-schemas/` served to API callers | us |
| `e2e/` | End-to-end scripts in Python (three of them drive a browser with Playwright) and two TypeScript helpers, run against a running app | us |
| `docs/` | `architecture/`, `operations/`, `decisions/`, `development.md`, and `rebuild/` (handbook for a later Java rebuild, with copies kept in sync by `scripts/sync-rebuild.mjs`) | us |
| `drizzle/` | Database schema (`schema.ts`) and migrations | Lovable only |
| `supabase/` | Supabase project settings | Lovable only |
| `.kiro/steering/` | Rules AI assistants load (invariants, product, tech, structure) | us, reviewed by a human |
| `.lovable/` | Lovable's own project notes | Lovable |
| `AGENTS.md`, `roadmap.md` | Project and repository rules; open work | us |
| `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `tsconfig.json`, `components.json` | Build, test, lint, types, shadcn settings | us, carefully (see the comments in `vite.config.ts`) |
| `.env`, `.env.example` | Public project settings (managed by Lovable); the list of variable names | Lovable / us |

## Inside `src/`

| Path | What lives there |
| --- | --- |
| `src/routes/` | Pages and API routes, file-based (`src/routes/README.md` explains the naming). `__root.tsx` is the app shell. `_authenticated/` holds every signed-in page behind one guard (`route.tsx`). `auth.tsx` is sign-in, `index.tsx` redirects to `/documents`, `design.tsx` is a design-system showcase available only in development |
| `src/routes/api/public/` | HTTP routes: `tmf-api/` (the public API, with its own `AGENTS.md`), `jobs/` and `tmf-events/` (scheduled) |
| `src/components/<area>/` | UI per area: `documents`, `review`, `search`, `upload`, `access`, `holds`, `admin`. `erad/` holds the design-system primitives (button, dialog, data table, side panel, app shell...). `ui/` is generated shadcn: do not edit |
| `src/hooks/` | One hook per screen concern (`use-document-actions.ts`, `use-document-search.ts`, `use-review.ts`, `use-upload.ts`...). They wrap TanStack Query around `api.ts` |
| `src/services/` | All server-side logic and the pure rules. Detailed map in `src/services/README.md` |
| `src/services/shared/` | Helpers used by every server path: `must.ts` (check a database answer), `server-context.ts` (`adminClient`, `todayUtc`) |
| `src/schemas/document.ts` | zod schemas and types for the seam inputs and document shapes |
| `src/lib/` | Browser-side helpers: user text for error codes and statuses (`document-labels.ts`), error capture and the error page used by `src/server.ts` |
| `src/integrations/supabase/` | Supabase clients (`client.ts` for the browser, `client.server.ts` privileged), the auth middleware, the cron secret check and the generated `types.ts`. Generated: do not edit |
| `src/styles/tokens.css`, `src/styles.css` | ERAD colour and spacing tokens, and the utilities that use them |
| `src/test/` | Test helpers (`fake-db.ts`, `gateway-world.ts`, `gateway-api.ts`, `setup.ts`) and repository-wide tests (hygiene, limits table, routing, hover contrast) |
| `src/server.ts` | The server entry: wraps rendering so an error shows a page instead of a blank screen |
| `src/start.ts` | Global middleware: CSRF protection, the error page for server functions, and attaching the user's token to server function calls |
| `src/router.tsx`, `src/routeTree.gen.ts` | Router setup; the generated route tree (do not edit) |

## The layers and who may call whom

```text
page (src/routes)            -> components, hooks
component (src/components)   -> erad primitives, hooks, pure rules (to decide what to show)
hook (src/hooks)             -> src/services/api.ts only
api.ts                       -> server functions (*.functions.ts)
server function              -> seam-runtime (runRead/runWrite), pure rules, write helpers
API route (api/public/...)   -> gateway-*.ts / tmf667-*.ts, scheduled-run.ts, tmf-events.ts
gateway / workers            -> pure rules, write helpers, the privileged client
pure rules (*-rules.ts)      -> nothing with I/O
```

- A component or hook never imports `client.server.ts`, `seam-runtime.ts` or a gateway file. Importing a type from a `*.functions.ts` file is fine. One older exception: `use-me.ts` calls `getMe` directly instead of through `api.ts`.
- The privileged client is loaded with a dynamic `import()` inside a server handler (`adminClient()` in `shared/server-context.ts`), so it never ends up in the browser bundle.
- A pure rule file imports types and other pure rules only. That is what lets the screens, the server, the API and the workers share it.

## Naming

| Pattern | Meaning | Example |
| --- | --- | --- |
| `*.functions.ts` | Server functions (`createServerFn` + `requireSupabaseAuth`) called by screens through `api.ts` | `document-status.functions.ts` |
| `*-rules.ts` | Pure rules, no I/O, with a test in `__tests__` | `upload-rules.ts` |
| `document-*.ts` | Server helpers for one document | `document-update.ts`, `document-delete.ts` |
| `gateway-*.ts` | The public API's server logic, one concern per file; `tmf-gateway.ts` lists them | `gateway-token.ts` |
| `tmf667-*.ts` | Mapping to and from TMF667 shapes; `tmf667-mapper.ts` lists them | `tmf667-events.ts` |
| `__tests__/*.test.ts` | Unit tests, next to the folder they test; `*.integration.test.ts` need the real backend | `access.integration.test.ts` |
| `use-*.ts` | React hooks | `use-me.ts` |

Some older file names are kept as re-exports so imports do not break (`document-write.functions.ts`, `tmf-gateway.ts`, `tmf667-mapper.ts`). Add new code to the specific file, not to the re-export.

House rules checked by `src/test/repo-hygiene.test.ts`: English only, at most 300 lines per file in `src/services`, docs point at files that exist, and module READMEs have the standard sections. Every file starts with a short comment saying what it is responsible for.

## I want to change... where do I look?

| I want to change | Look at |
| --- | --- |
| Who may do what (roles) | `can()` and `transitionCapability()` in `src/services/document-rules.ts` |
| The status path | `ALLOWED_TRANSITIONS` in `src/services/document-rules.ts` |
| Which buttons a person sees and the reason text | `src/services/document-actions.ts` |
| The check-details journey and the approve gate | `review-flow-rules.ts`, `review-rules.ts`; the server gate (own work, then required details) is `document-approval.ts`, used by the screens and the API |
| Upload rules (types, size, duplicates) | `src/services/upload-rules.ts` (`typeRefusal`, the same rule for the screen, the server and the API); storing the first version is `document-first-version.ts`; the simulated pipeline is in `pipeline.functions.ts` |
| Search, filters, bulk changes | `search-rules.ts`, `search.functions.ts`, `bulk-worker.ts` |
| Legal holds, deletion, restore | `setHold`, `deleteDocument`, `restoreDeleted` in `document-status.functions.ts`; the same in `gateway-changes.ts`; shared pieces `holdColumns` (`document-update.ts`) and `deleteIfAllowed` (`document-delete.ts`); button states in `document-actions.ts` |
| Holds and retention overview, permanent deletion | `retention.functions.ts`; the keep-until rule is `retentionHolds` in `document-rules.ts`, the group minimum `retention-floor.ts` |
| Sharing and access exceptions | `document-access.functions.ts`; the explanation "why can I see this" is in `review-rules.ts` and `src/components/access/` |
| Expiry, cleanup of old keys and tokens, given-up deliveries | `maintenance.ts` (scheduled), `expiry-fallback.ts` (safety net on reads), `delivery-dead-letter.ts` |
| Group and country settings | `tenant-rules.ts`, `tenant-config.functions.ts`, `tenant-config-write.functions.ts` |
| The API other systems use | `src/services/tmf-gateway.ts` (names the `gateway-*.ts` files), `tmf667-mapper.ts` (names the `tmf667-*.ts` files), `contracts/seams/tmf667-document.openapi.yaml` |
| Connected systems, keys, rate limits per system | `integration-clients.functions.ts` (where an admin sets them), `rate-limit-rules.ts` (the rule), `gateway-token.ts` |
| Event delivery and retries | `event-delivery-rules.ts`, `tmf-events.ts` |
| The order of checks for every write | `src/services/seam-runtime.ts` |
| User text for an error code or a status | `src/lib/document-labels.ts` |
| A limit (sizes, batches, lifetimes) | `docs/architecture/limits.md` names the constant and its file |
| Which helper to use in a service | `src/services/README.md` |
| A screen | the route in `src/routes/_authenticated/` (for example `documents.tsx`) and the components it imports from `src/components/<area>/` |
| Colours, spacing, tokens | `src/styles/tokens.css` and `src/styles.css` |
| The database (tables, RLS, SQL functions) | Ask the owner: `drizzle/` is managed by Lovable |

How to add each kind of thing, step by step: `docs/development.md`.
