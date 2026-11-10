# Version comparison summary with confirmed contractual changes

## What people will see
In the document panel, when a document has two or more versions, a new **"What changed"** section appears under Versions:

- A version picker ("Compare version 2 with version 3"), defaulting to the current version vs the one before it.
- A **Compare versions** button. The summary streams in, then shows a short plain-language overview plus a list of changes, grouped as:
  - **Clauses** — e.g. "Termination notice: 30 days → 60 days" (added / removed / changed).
  - **Details** — the document's extracted details that differ between versions (quote number, valid until, VAT number, price…).
- Each change shows **where it comes from**: "Version 3, page 2" with the exact quoted line, and a link that opens the preview at that page with the line highlighted. Both sides (old and new) are linked.
- Each change is tagged **Contractual** or **Informational** (wording, formatting).
- Contractual changes need a person: **Confirm change** or **Not a real change** (with an optional note). Progress reads "1 of 3 contractual changes confirmed".
- **Approve** stays unavailable with the reason "Confirm the 2 contractual changes in What changed before approving." Informational changes never block.
- The summary is labelled "Suggested by AI — please check against the source". Nothing is accepted automatically.
- If AI is unavailable: "We couldn't prepare the summary right now" with **Try again** and **Continue without AI** (approval then follows today's rules, and the activity log records that the comparison was skipped by that person).
- Viewers can read the summary; only reviewers and managers can confirm.
- Restricted documents are not sent to AI; the section explains why and offers Continue without AI.

## Rules
- A comparison belongs to a pair of versions. If a new version is added, the old comparison no longer counts and a new one is needed before approval.
- Approval is blocked while any contractual change for the current version is unconfirmed — enforced on the server for people and for connected systems (TMF API returns 409 `contractualChangesPending`).
- The person who added the document can't confirm its changes (same four-eyes rule as approval).
- The activity log records "Compared versions", "Change confirmed" / "Change dismissed" — change titles only, never the document text.

## Technical details
- **Database (migration):** `version_comparisons` (document, from/to version, tenant, model, status, summary, created_by/at) and `comparison_changes` (comparison, kind clause|detail, category contractual|informational, title, before/after text, source refs `{versionId,page,excerpt}` for each side, status pending|confirmed|dismissed, decided_by/at, note). GRANTs + RLS reading through `can_see_document`; writes via service role only.
- **Pure rules** `src/services/comparison-rules.ts` (tested): comparison is current for the current version pair, pending contractual count, approve gate, who may confirm, source-ref validation (every reference must point to a real page/line of the named version; changes with invalid sources are dropped).
- **Server** `src/services/comparison.functions.ts` (`requireSupabaseAuth`): `compareVersions`, `getComparison`, `decideChange`, `skipComparison`. Text comes from each version's page text; extracted details come from `extraction_fields` per version.
- **AI Gateway:** server-only call to `/v1/responses` with `openai/gpt-6-astra`, streamed, strict JSON schema output, reasoning `low`. Because the project rule is "no new libraries", this uses a small server-side fetch + stream reader instead of installing the AI SDK. Document text is passed as untrusted data (never as instructions). Error handling per gateway rules: 429/5xx bounded retry, 402/403 shown with their message and no retry.
- **Approval gate:** `transition` (app) and TMF `applyTransition` both call the comparison gate before approving.
- **UI:** `src/components/documents/version-compare.tsx` (+ change row component), hook `use-version-compare.ts`, panel shows it under Versions; preview opens at the linked page with highlight. `document-actions.ts` adds the new Approve reason.
- **Test data:** add a two-version Sweden contract with clause changes to the test reset, so the flow can be tried.
- **Tests:** unit tests for comparison rules and approve gate; browser check of compare → confirm → approve; API check that approval is refused while changes are pending; one live AI call verified.
- Update AGENTS.md, contract notes and the rebuild handbook (new business rules).
