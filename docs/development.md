# Development

How to set up, check and change the code. The map of the code is in `docs/architecture/code-organization.md`; how it works at runtime is in `docs/architecture/ARCHITECTURE.md`.

## Set up

1. Install [bun](https://bun.sh). Python 3 with Playwright is only needed for the `e2e/` scripts.
2. `bun install`.
3. `.env` comes from Lovable and holds only public project settings. If it is missing, copy `.env.example` and fill in the public values of the connected Supabase project (ask the owner).
4. `bun run dev` and open the URL it prints. Log in with a demo account (ask the owner, see `.github/CODEOWNERS`).

What works locally: every screen and every read. What does not: privileged writes (registering documents, connected systems, the API end to end), because the server-side key exists only in the hosted environment. You will see `Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY` in the server log. Check those paths on the preview after publishing (`docs/operations/regression-after-publish.md`). Never put the key in `.env`.

`AGENTS.md` holds the project and repository rules. Its first block, between the `LOVABLE` markers, is maintained by Lovable and describes what Lovable owns; the project's own rules start at "Project rules".

Server logs are JSON lines on stdout: in the terminal of `bun run dev` locally, in Lovable for the preview and the published app.

## The gate

There is no CI. Before every commit:

```sh
bun run check      # eslint, tsc --noEmit, vitest run, vite build
```

It also runs the repository hygiene tests (`src/test/repo-hygiene.test.ts`): English only, at most 300 lines per file in `src/services`, docs point at files that exist, module READMEs have the standard sections, and the copies in `docs/rebuild` are up to date (`bun run sync:rebuild` refreshes them).

After changing anything about access, tenants or the database functions, also run `RUN_ACCESS_TESTS=1 bun run test` (signs in as demo users, read only).

`bunx vitest run src/services/__tests__/document-rules.test.ts` runs one test file; `bun run test:watch` keeps tests running while you work. `bun run format` runs prettier. Commit messages are English and say what changed and why; one commit holds one kind of change (a fix and a refactor never share one), and a fix comes with the test that fails without it.

## Tests

| Kind | Where | Runs with |
| --- | --- | --- |
| Pure rules | `src/services/__tests__/*-rules.test.ts`, `document-actions.test.ts` | plain inputs, no database |
| Service code (server functions, helpers, workers) | `src/services/__tests__/` | `FakeDb` from `src/test/fake-db.ts`: an in-memory stand-in for the Supabase client. It does not enforce RLS, triggers or SQL functions |
| The public API | `src/services/__tests__/gateway/` | a whole world built by `src/test/gateway-world.ts` and requests sent through `src/test/gateway-api.ts` |
| Access against the real backend | `*.integration.test.ts` | `RUN_ACCESS_TESTS=1` |
| Repository rules, the limits table, routing | `src/test/` | always |
| End to end | `e2e/*.py` | a running app with the server-side key (the preview) |

Write the test first and watch it fail for the right reason. A test that uses `FakeDb` proves the application's checks only; say so in the test when the database would also enforce the rule.

## Recipes

### A new screen

1. Add `src/routes/_authenticated/<name>.tsx` with `createFileRoute("/_authenticated/<name>")`. The route tree (`src/routeTree.gen.ts`) regenerates on `dev` and `build`; do not edit it. Everything under `_authenticated/` is behind sign-in.
2. Build it from `src/components/erad/` primitives and token utilities. No hex colours outside `src/styles/tokens.css`. An unavailable action uses `aria-disabled` and shows its reason, never native `disabled` (`docs/architecture/accessibility.md`).
3. Put area components in `src/components/<area>/` and data in a hook in `src/hooks/` that calls `api.ts`.
4. Decide what to show with the pure rules (`document-actions.ts` and friends), never by re-implementing a role check in the component.
5. Add it to the navigation in `src/components/erad/app-shell.tsx` if it needs a menu entry.
6. Check it in the browser in both themes, with the keyboard, and with an accessibility checker.

### A new server function

Reads go through `runRead` and run as the caller. Writes go through `runWrite`. A write follows this shape (see `document-status.functions.ts`):

```ts
// The shape only: doSomething, its schema, the error code and the action name are placeholders.
export const doSomething = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof doSomethingSchema>) => doSomethingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { idempotencyKey, ...body } = data;
    return runWrite(
      context,
      await adminClient(), // loads the privileged client only here, on the server
      { op: "doSomething", idempotencyKey, body, scope: { kind: "doc", id: data.id } },
      async (env) => {
        if (!can(env.role, "edit")) return forbidden(); // role first
        const doc = await loadDoc(env.admin, data.id);
        if (!doc) return fail("doc.notFound", "notFound");
        // apply the pure rule here, and return fail(...) when it refuses
        const changed = await updateDocumentIf(
          env.admin,
          { id: data.id, tenantId: env.tenantId, expect: { status: doc.status } },
          { /* columns */ },
          "doing something to a document",
        );
        if (!changed) return fail("doc.changedMeanwhile", "conflict");
        await audit(env, "someAction", data.id, "short detail, no content"); // part of the change
        return { ok: true, data: await loadDoc(env.admin, data.id) };
      },
    );
  });
```

1. Add the input schema to `src/schemas/document.ts` (include `idempotencyKey` for writes, like the other write schemas).
2. Put the function in the `document-*.functions.ts` file for its area (or a new one; list it in `document-write.functions.ts`). Choose the scope: `doc` for one existing document, `tenant` for something inside the caller's tenant (then filter every query by `env.tenantId` yourself).
3. Use the helpers in `src/services/README.md` instead of raw queries: `must()`, `updateDocumentIf`, `holdColumns`, `deleteIfAllowed`.
4. Expose it in `src/services/api.ts` (`write(...)` adds a fresh idempotency key) and add user text for any new error code in `src/lib/document-labels.ts`.
5. Test it with `FakeDb`: the allowed case, each refusal, a database failure (must report "unavailable", not success) and a repeated key.

### A new rule about documents

1. Write it as a pure function in the matching `*-rules.ts` file, with a test.
2. Apply it at every entry point: screen state, server function, TMF API, bulk changes. The list is in `docs/architecture/ARCHITECTURE.md` under "Adding or changing a rule about a document".
3. Add a case to `src/services/__tests__/rule-parity.test.ts` so the entry points cannot drift apart.
4. If it is a rule no change may break, add it to `.kiro/steering/invariants.md`.

### A new endpoint in the public API

1. Write the logic in a `gateway-*.ts` file (start from `gateway-core.ts`: `authenticate` first, every query pinned to the system's tenant, errors through `errorReply`) and export it from `tmf-gateway.ts`. Map shapes in a `tmf667-*.ts` file.
2. Add a thin route under `src/routes/api/public/tmf-api/document/v4/` that calls it, with `otherMethods([...])` so other methods answer 405. If the legacy alias must have it too, add the same route under `documentManagement/v4/` wrapped in `legacy(...)`.
3. Read bodies with the bounded readers (`gateway-body.ts`), take `Idempotency-Key` on changes (`gateway-idempotency.ts`), and reuse the same pure rules as the screens.
4. Update `contracts/seams/tmf667-document.openapi.yaml` and, when the rules change, `src/routes/api/public/tmf-api/AGENTS.md`.
5. Test it in `src/services/__tests__/gateway/` with `gateway-world.ts`, including another tenant's document (must be "not found") and a body over the limit.

### A new scheduled task

1. Add a step to `runMaintenance` in `maintenance.ts`. It works in batches with a named limit, touches every tenant, and records one activity event per changed document. A failing step must not stop the others; it is reported in `failed`.
2. Add its limits to `docs/architecture/limits.md` (`src/test/limits-doc.test.ts` checks the table against the code) and its answer field to `docs/operations/runbook.md`.
3. Never run it inside a person's request. A new scheduled route needs `authenticateCronRequest` and a scheduler entry, which is configured in Lovable, not in this repository.

### A database change

Ask the owner to make it in Lovable: `drizzle/` and `supabase/` are Lovable's. After it lands, `src/integrations/supabase/types.ts` is regenerated, then adjust the code, the `FakeDb` seeds in tests, and run the access tests. A new table that a screen reads needs a row-level security policy; a table only the server uses needs none (service role only).

### A new limit or time constant

A named, exported constant with a comment that says why it has that value, and a row in `docs/architecture/limits.md`.

## Pitfalls

- **Ignoring `error`.** The Supabase client never throws: a failed query looks like "no rows". Wrap every query in `must(await query, "what you were doing")`.
- **Deciding from a read and writing without a condition.** Use `updateDocumentIf`, or a change made in between is overwritten.
- **Forgetting the tenant.** With `scope: { kind: "tenant" }`, every query in the handler must filter by `env.tenantId`. A share lets another tenant see a document, never change it.
- **Importing the privileged client at the top of a file.** Use `adminClient()` (a dynamic import inside the handler); a static import can pull it into the browser bundle.
- **`select("*")` on `documents`.** The generated search column breaks the types; name the columns.
- **Writing an activity event from the browser.** Clients may record only `view` and `download`. Every other event is written by the operation itself, and never carries detail values or content.
- **Logging content.** Log lines carry an `op`, ids and codes. Never names, reasons, details or database text.
- **Growing a big file.** Files in `src/services` stay under 300 lines; put new code in a new file next to the old one.
- **Editing generated files.** `src/integrations/supabase/*`, `src/routeTree.gen.ts`, `src/components/ui/`, `drizzle/`. They are overwritten.
- **Vite config.** Do not add plugins that `@lovable.dev/vite-tanstack-config` already includes, `ssr.external` or compression (the comment in `vite.config.ts` says why).
- **Non-English text.** All code, UI text, messages and docs are English; the hygiene test catches common Portuguese.
- **Rewriting history.** Never force-push or amend published commits: Lovable syncs from `main`.
