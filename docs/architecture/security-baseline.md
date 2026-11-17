# Security baseline

What was checked, with which tools, and how to repeat it. Status as of 2026-11-17.

## Secrets

- Tool: gitleaks 8.30.1 over all refs, including the diffs of merge commits (`--log-opts="--all -m"`), values redacted. It reported 4 findings, all rule `generic-api-key`, all in `.env`, which appears in 2 commits.
- Each value in both versions of `.env` was classified without printing it: every one is an `sb_publishable_` key (public by design in Supabase and protected by row-level security), a project URL or a project id. A pattern search over the history found no match for a Supabase secret key, a service-role value or a JWT. The findings are assessed as false positives of the rule. The pattern search is not a proof of absence.
- `.env` stays tracked because Lovable manages and regenerates it. Do not add real server secrets to it. Every variable name is in `.env.example`.

## Dependencies

- Tool: osv-scanner 2.7.1 on `bun.lock`. Results are kept internally. A dependency upgrade is its own change: bump, `bun run check`, then look at the app.

## Repeat the checks

Both tools are single binaries from their GitHub releases and are not project dependencies.

```sh
gitleaks detect --redact --log-opts="--all -m"
osv-scanner scan source --lockfile bun.lock
```

## Review status

AI-assisted review was used on some changes. It does not replace a human security review.
