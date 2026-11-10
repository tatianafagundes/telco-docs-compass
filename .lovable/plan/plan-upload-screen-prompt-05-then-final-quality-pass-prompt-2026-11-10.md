# Plan: upload screen (prompt 05), then final quality pass (prompt 12)

Order: build the upload screen first, so the quality pass also covers it and is done once.

## Part A – Add documents (prompt 05)

On a record's Documents tab:
1. **Ways in:** "Add documents" button, drag-and-drop anywhere on the tab (overlay "Drop to add to O-7731"), and paste. Several files at once. Dropping a file anywhere else in the app shows "Open an order's Documents tab to add files" instead of the browser opening the PDF.
2. **Dialog (572px):** one row per file – name, size, document type, required details for that type. Default type is chosen safely with a reason line ("Based on: added to an order"). Checks per file: unsupported type, too large, same name already here (offers "Add as new version of …"). Helper line: "Prototype: do not add real customer files." Buttons "Cancel" and "Add N documents".
3. **Progress:** new rows appear at the top straight away; tag moves Uploading → Scanning → Reading → Ready. "Ready" stays visible until you leave the tab. New files start as Draft. A toast "Adding 3 documents" shows each file and ends with "3 added: 2 ready, 1 needs attention"; the screen reader hears only that final line.
4. **Problems, in plain words:** upload stopped (Retry), quarantined (Delete, Report to security – no download anywhere), couldn't read the text (Keep without reading, Retry once, Delete). "Retry 2 failed" retries only failed files; cancel per file.
5. **Who can add:** viewers can't (button shown unavailable with reason); everyone else can. Holds and retention don't block adding.
6. **Test files:** your three site survey PDFs should all reach Ready. Files containing `TEST-QUARANTINE` (or ending .exe) are quarantined; `TEST-UNREADABLE` fails reading, also on retry. Scanning is simulated and says so.

## Part B – Final quality pass (prompt 12)

1. **Look and spacing:** colours only from tokens; row, control, panel and dialog sizes as specified.
2. **Every screen state:** loading, empty (warm, with next step), error (with Retry) on documents, record, panel, upload, admin and holds pages.
3. **Layouts:** screenshots at 1440 and 1920 wide, light and dark – no sideways scrolling, nothing clipped.
4. **Accessibility:** keyboard path through list, panel, upload, sharing; visible focus ring; names on icon buttons; tags not colour-only; dialogs keep and return focus; reduced motion honoured; 200% zoom readable.
5. **Country isolation proofs:** signed in as Norway manager (sees no Swedish documents), group admin (counts and settings only, no documents), Sweden viewer (only the one order). Added to the automated access checks.
6. **Security:** quick and deep security scans; fix anything found.
7. **Wording review:** sentence case, banned phrases removed, no raw errors.
8. **Decision notes:** one short note per deviation from DESIGN.md (DESIGN.md itself untouched).
9. **"Reset test data"** button under Admin, group admin only: restores the demo records, removes uploaded files, and shows check counts.
10. **Held-document check:** click through delete on a held document and confirm it's blocked with a clear reason.

Ends with a one-line report per area.

## Technical details

- Upload: `register` (idempotency key per file) → signed upload to the private `documents` bucket → simulated pipeline via a server function that advances `processing_state` (marker detection by file name/content). Storage RLS on `storage.objects` scoped to tenant path prefix, added by migration if missing.
- New: `src/components/upload/*` (dialog, drop overlay, progress toast), `src/hooks/use-upload.ts`, pure default-type and validation rules in `src/services/upload-rules.ts` with tests; global drop guard in the authenticated layout.
- "Keep without reading" uses `updateMetadata` with `keepUnread`; "Report to security" uses `reportProblem` kind security.
- Reset: `createServerFn` with `requireSupabaseAuth`, checks master_admin role first, then service-role reset of seed rows and storage cleanup (not an edge function, matching AGENTS.md).
- Isolation proofs extend `access.integration.test.ts` (RUN_ACCESS_TESTS=1). Layout/a11y checks via Playwright screenshots.
- English only, no new libraries.
