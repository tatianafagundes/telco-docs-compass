# Prompt 09 – Screen 7: global search

Read AGENTS.md and docs/ui-references.md (Drive fcb56b4a chips, Linear ed670cda filters, Dash f6731429, Gumloop 3c463897 empty). Plan first, wait for OK.

Build global search: a field in the system header (Ctrl/Cmd+K focuses it) opening the route `/search` with **no query parameter** (the text stays in app state).

Behaviour:
- Query goes through `find` (POST body; text never appears in the URL – keep `q` only in app state/history state, not in the address bar, because search text may contain personal data).
- Exact matches first: contract number (MSA-SE-2025-0187), quote number, order id, MSISDN-like numbers: show a top block "Exact match" with that document or entity. Then results ranked by text match on name, characteristic values and (for documents with sample_pages) page text. Mark the match in the snippet.
- Permission filter happens before retrieval: results are only what the user may see. Never reveal that hidden documents exist. If a filter combination returns nothing and the user is a viewer, show: "No documents match. Some results may be hidden by your access." (generic, shown only when no results).
- Filter chips above the list: Type, Status, Processing, Related to, Updated, Signature, Sensitivity; saved filters not included. "Clear all" always visible when any chip is active.
- Result row = the same table row as the Documents tab (name, type, status, entity, version, updated) with a snippet line; selecting opens the same preview panel.
- AI answer (optional block, AI-styled): below the field a button "Ask about these documents" opens a short answer built ONLY from the visible, ready documents, in the form: answer in 1–3 sentences, then **Sources** listing each as "[1] Master Service Agreement – Nordlys Retail AB, page 1" linking to the page highlight. If the answer is not supported by the sources: "I could not find this in the documents you can see." No source, no claim. The prototype may produce answers from keyword/field matching over seeded text; label the block "Preview of AI answers – built from sample text". The answer block is an ordinary Card with the tag "AI answer"; only the "Ask about these documents" button carries the AI gradient. Never include documents outside the user's access.
- Empty (no query) shows recent documents and recent searches (stored per user, local only, cleared on sign-out: agent desktops are shared).

Performance feel: results update as the user types after 250 ms; keyboard: arrows move through results, Enter opens, Esc clears.

States: loading skeleton, results, exact-match, none ("No documents match 'xyz'. Check the number or clear filters."), offline error with Retry, as se.viewer vs se.admin (different counts), as no.manager (never sees Sweden).

Verify at 1440 and 1920, light and dark, keyboard, and report in one line. Test that se.viewer (who has access to order O-7731 only) searching "dispute" does not learn that the Nordlys account's dispute document exists.
