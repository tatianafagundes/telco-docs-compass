# Prompt 06 – Screen 5: versions, naming, compare, restore

Read AGENTS.md and docs/ui-references.md (Figma e024e911, Notion 780626a3/e8ed9805, Linear 6c14e085, Drive fdba2151). Plan first, wait for OK.

Fill the "Versions" tab of the preview panel.

List (newest first): each row shows label ("3 · Signed"), tag "Current" on the current one, author, relative time + date on hover, size, and a note if any. Automatic checkpoints are grouped and collapsed ("5 automatic versions") between named versions; named versions are prominent. Selecting a version previews it in the preview area with a context bar across the top of the preview: "Viewing version 2 · Legal review — Restore this version | Compare with current | Exit". The panel never edits the current version silently.

Actions per version (menu and keyboard): Name this version (inline field with optional note "What changed?"), Restore this version, Compare with current, Download this version, Copy link.

Restore: a dialog states the consequence in words: "This creates version 6 with the content of version 2. Version 5 stays in the history." Buttons: Cancel (default), Restore (primary). Restoring calls `addVersion` with `restoreFromVersionId`, adds an Audit event, and never overwrites. Not allowed (`aria-disabled` with reason) when the document is superseded, expired or archived. A legal hold does **not** block restore: a hold keeps versions, it does not freeze them.

Add new version: "Add version" accepts a file, optional label and "What changed?" note, then follows the same pipeline as prompt 05. The new version becomes current only when its pipeline reaches Ready; until then the list shows it as "Processing" and the current one stays current.

Compare: opens a wide dialog (DESIGN.md dialog tokens; wider than 572px is a divergence: write the reason to `docs/decisions/<date>-compare-dialog.md`, never edit DESIGN.md; max-height 100vh − 32px, content scrolls, action row stays visible): left = selected version, right = current; header shows both labels; page-by-page side by side using sample_pages; a "Differences" navigator ("1 of 3", up/down) highlights changed lines; below, a metadata diff table (field, before, after). If a version has no sample_pages, say "Comparison unavailable for this file type" and show only metadata.

Retention behaviour: show an info row "Versions are kept while retention or a hold applies." Hold prevents pruning (no prune UI in this prototype); say so in text.

States: single version (list shows one row, no group), many (30) with collapsed groups, processing, failed version, read-only role (no restore/name), comparing unsupported type.

Verify at 1440 and 1920, light and dark, keyboard only, as se.manager and se.viewer; confirm versions cannot be edited (try to change one: it must fail). Report in one line.
