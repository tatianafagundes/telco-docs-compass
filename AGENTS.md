<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Hex colour values live only in `src/styles/tokens.css`; components use ERAD token utilities from `src/styles.css`. Why: one source for both themes.
- ERAD primitives live in `src/components/erad/`; unavailable controls use `aria-disabled` plus visible reason text, never native `disabled`. Why: the reason must stay keyboard-reachable.
- The document seam (contracts/seams/document.openapi.yaml) is implemented as `requireSupabaseAuth` server functions in `src/services/document.functions.ts`, not edge functions. Reads run as the caller (RLS); writes use the service role after an explicit role/access check and append their own audit event. Why: TanStack Start stack, schema allows writes only via service role.
- Clients may record only `view` and `download` audit actions. Why: all other events are written by the operation itself.
- Seam operations return `SeamResult` (`{ok,data}` or `{ok:false,error:SeamError}`) instead of throwing; `src/services/api.ts` unwraps into `SeamFailure` and is the only backend entry for screens. Why: typed customer-facing errors cross the RPC boundary intact.
- Pure document rules (status path, approve gate, delete blockers, idempotency) live in `src/services/document-rules.ts` with tests in `src/services/__tests__/`. Why: rules are testable without a database.

- Which document actions a person sees, and the reason text for unavailable ones, comes from `src/services/document-actions.ts` (pure, tested). Why: UI gating stays consistent with server role rules.
- Access checks against the real backend live in `src/services/__tests__/access.integration.test.ts` and run only with RUN_ACCESS_TESTS=1. Why: normal test runs stay offline.
- Group/country configuration lives in `src/services/tenant-config.functions.ts` with pure checks (locks, inheritance mode, hard floors) in `src/services/tenant-rules.ts`. Why: the same rules run on the server and in the UI, and are tested.
- Tenant-crossing RLS uses SECURITY DEFINER helpers (`user_tenant`, `my_parent_tenant`, `is_my_child_tenant`), never subqueries on the same table. Why: self-referencing policies recurse.
- Holds, retention, deletion history and permanent deletion live in `src/services/retention.functions.ts`; permanent deletion leaves a `purged_at` tombstone. Why: versions and events are append-only.
- Adding documents: pure rules in `src/services/upload-rules.ts` (tested), simulated pipeline and the master-only test reset in `src/services/pipeline.functions.ts`; a global drop guard in the app shell stops the browser opening dropped files. Why: the pipeline is a prototype stand-in that must behave the same in every test session.
- Detail review and access explanations: pure rules in `src/services/review-rules.ts` (tested); `reviewExtraction` copies accepted/edited values into `documents.characteristic` and audits the field name only. Why: the approve gate and the UI read the same counts, and values never reach the activity log.
- ERAD `Dialog` remembers the focused element when it opens and returns focus there on close. Why: dialogs open from plain buttons, not Radix triggers.
- Shared-only documents open at `/shared/$docId` through `DocumentPanel` with `entityId={null}`; `listSharedWithMe` returns a record id only when the caller can read that record, and never record names. Why: direct shares must not leak record details.
- Share and cross-country leak regressions: data level in `src/services/__tests__/share-isolation.integration.test.ts` (RUN_ACCESS_TESTS=1), pages plus server replies in `e2e/share-isolation.py` (Playwright, exits 1 on failure). Why: shares can only change through the app, so the remove flow needs a browser.
- TMF667 API for connected systems: routes under `src/routes/api/public/tmf-api/documentManagement/v4/` are thin; logic is in `src/services/tmf-gateway.ts` (system-key check first, every query pinned to the key's tenant) and pure mapping in `src/services/tmf667-mapper.ts` (tested). Keys are stored hashed in `integration_clients`; events come from a `documents` trigger into `event_outbox`, delivered by the scheduled `/api/public/tmf-events/deliver`. Why: other systems get the same rules as the screens without ever touching a person's session.
- TMF API routes spread `otherMethods([...])` into their handlers and `src/routes/api/public/tmf-api/$.ts` catches unknown paths, so systems always get TMF JSON (405/404), never the app page. Regression: `e2e/tmf-api.py` (Playwright + HTTP, exits 1 on failure). Why: unhandled methods otherwise answer 200 HTML.
- Documents search at scale: visibility and filters are built once per request by `_doc_search_where` (SECURITY DEFINER, same rule as `can_see_document`, values inlined with %L) and used by `search_documents` (keyset paging), `count_documents` (capped at 10,001), `facet_documents` and `search_document_ids`; screens reach them through `src/services/search.functions.ts`, pure rules in `src/services/search-rules.ts` (tested). Bulk changes resolve ids as the person, then `src/services/bulk-worker.ts` re-checks each document and audits it. Why: per-row RLS functions don't scale to millions of rows, and one builder keeps every search path on the same access rule.
- Never `select("*")` on `documents` for screens: the generated search column has no usable type and breaks server-function typing. Why: it silently turns the result into `{}`.
