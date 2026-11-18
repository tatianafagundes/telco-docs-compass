# Security baseline

What is protected and where, what was checked with which tools, and how to repeat it. Status as of 2026-11-17.
## Controls and where they live
Each has tests in `src/services/__tests__/`. The rules themselves are in `.kiro/steering/invariants.md`.
- Tenant isolation and access before replay: `runWrite` in `seam-runtime.ts`; the API and bulk changes pin every query to one tenant.
- System keys and tokens: keys stored hashed; tokens short-lived, limited per caller address and per system, at most 10 live per system, removed when the key is rotated or revoked (`gateway-token.ts`).
- Outbound requests for a caller: https only, no internal names or private addresses, DNS answers checked, no redirects, size and time capped (`tmf667-security.ts`, `gateway-fetch.ts`, `ip-rules.ts`).
- Request size: bodies are read up to a limit, never in full (`gateway-body.ts`); every limit is in `docs/architecture/limits.md`.
- Repeated and racing requests: the idempotency key is reserved before the work runs (`idempotency-claim.ts`); conditional updates do not overwrite a change made in between (`document-update.ts`).
- Failing safe: database errors are never read as "no rows" (`shared/must.ts`); a change whose activity entry cannot be written is reported as failed; logs carry step names and ids, never database text or document content.
- Scheduled routes need the scheduler's secret (`src/integrations/supabase/cron-auth.ts`).
- Accessibility is in `docs/architecture/accessibility.md`.

## Secrets

- Tool: gitleaks 8.30.1 over all refs, including the diffs of merge commits (`--log-opts="--all -m"`), values redacted. It reported 4 findings, all rule `generic-api-key`, all in `.env`, which appears in 2 commits.
- Each value in both versions of `.env` was classified without printing it: every one is an `sb_publishable_` key (public by design in Supabase and protected by row-level security), a project URL or a project id. A pattern search over the history found no match for a Supabase secret key, a service-role value or a JWT. The findings are assessed as false positives of the rule. The pattern search is not a proof of absence.
- `.env` stays tracked because Lovable manages and regenerates it. Do not add real server secrets to it. Every variable name is in `.env.example`.

## Dependencies

- Tool: osv-scanner 2.7.1 on `bun.lock`. Results are kept internally. A dependency upgrade is its own change: bump, `bun run check`, then look at the app. Last update: 2026-11-17 (in-range updates and vite 8.1.6). What is left needs a major upgrade or has no fix released yet.

## Repeat the checks

Both tools are single binaries from their GitHub releases and are not project dependencies.

```sh
gitleaks detect --redact --log-opts="--all -m"
osv-scanner scan source --lockfile bun.lock
```

## Review status

AI-assisted review was used on the changes of 2026-11-17 (several independent reviewer passes, mutation testing of the new tests, gitleaks on every published commit). It does not replace a human security review, which has not been done yet.
