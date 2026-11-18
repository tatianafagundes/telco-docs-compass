# Runs on Lovable (Cloudflare Workers) for now

Context: the app is hosted by Lovable. The build targets Cloudflare Workers (`nitro` writes `wrangler.json`). A move to an internal Ericsson environment is planned but not designed.

Decision: harden for Workers now, and list what must be redone when the target changes.

What it means today:
- Outbound fetches for a caller (callback addresses, attachments by url) are checked before they are made: https only, the host's DNS answers must all be public (`ip-rules.ts`), redirects are refused, size and time are capped (`gateway-fetch.ts`). Workers cannot connect to a checked IP while sending the original host name, so the check and the connection can resolve differently (a time-of-check gap). On Workers the private network is not reachable from the code, which keeps the risk low; the checks stay as defence in depth.
- Limits kept in memory (token requests, access-denied logging, expiry safety net) are per Worker instance, so they are approximate across instances. The database limits (per-system API allowance) are exact.
- The service-role key exists only in Lovable Cloud, so privileged writes can only be tested end to end against the preview (`docs/operations/regression-after-publish.md`).

When moving to an internal environment (likely Node in a cluster):
- Resolve the host once and connect to the checked address (pin it), or route outbound calls through an egress proxy that enforces the same rules. The private network will be reachable there, so this stops being optional.
- Move in-memory limits to a shared store if more than one instance runs.
- Replace the managed scheduler call with the platform's cron, with the same secret check.
- Put secrets in the platform's secret store; nothing in the repository changes.
