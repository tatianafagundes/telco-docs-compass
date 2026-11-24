# File hooks screens: design review (spec R5)

Reviewed from the nine gallery captures (light and dark, 1366 wide) plus the code listed in the request. Nothing was run. Severity: **blocker** (fix before release), **should** (fix in this round), **nit** (preference or polish, declared as such).

## Ruler used

- No `DESIGN.md` in this repository (`docs/design/` holds only `ui-review-2026-11.md` and `add-documents-findability.md`). A `DESIGN.md` exists in a different project (`~/Library/CloudStorage/OneDrive-Ericsson/Documents/design/DESIGN.md`); it is **not** used here. Adherence to a design system: not evaluated. Copy is checked against spec R5 and `ui-review-2026-11.md`.
- Decided and not reopened: Delete offered for every failure and blocked file (managers); unreadable offers Try again regardless of earlier retries; two rows with a button and a confirmation dialog instead of a switch; one `role=alert` region for failures.

## Promise of the screens

When a file waits for, or fails in, the organisation's own antivirus or reader, the person can see which system, since when, what went wrong and what to do. An admin can choose which system processes files, knowing the effect.

## What is already right (do not touch)

- The failure copy names the system, the time limit and the next step (02, upload card). "Keep without reading" is never offered for a scan step.
- Button order is the same in the upload card and the panel: Try again, Keep without reading, Report a problem, Delete.
- The waiting line gives the system and `Since 14:25` in the same words in the card, the panel and the list.
- Switch rows state current mode (tag), what happens (sentence) and the action (button named for the target). The dialog says what happens and that it is recorded.
- The disconnect dialog states what happens to waiting files and to new ones (07). The red Disconnect button is right.
- The connect dialog explains that checking and reading need a key of their own, and the helper under the name field says where the name appears (08).
- Disabled controls give a reason as visible text, not only `title`.

---

## Blockers

### B1. The same file failing twice is silent for a screen reader, and failures are merged into one alert
- State: record page, `processing-announcer.tsx`. Evidence: code.
- Sentence: a screen-reader user who presses Try again on a file that fails again **doesn't hear it and doesn't notice**.
- Why: `setUrgent(loud)` writes the same string ("Report.pdf: needs attention.") as last time. React sees no change, the DOM text does not change, nothing is announced. Separately, all failures in one refresh are joined into one string in one region, which is not "an alert per failure" as decided.
- Fix: render one child per announcement with a fresh `key` (a counter), inside the same `role=alert` container, and clear the container after about 5 s. Same for the polite region (a file that goes ready, then Try again, then ready again repeats text). Add a test: failed, scanning, failed again for the same document produces two announcements.

### B2. A scan failure and a file that never arrived are labelled "Couldn't read"
- State: 01 (Scan error.pdf), 02, and the record table's Status column. Evidence: capture and `document-labels.ts` (`failed: "Couldn't read"`).
- Sentence: the uploader, on seeing the list, **doesn't trust the tag**: it says reading failed when the antivirus failed (or the file never arrived), and in the record table the tag is all there is. The reason is only in the card or the panel.
- Why it matters here: the wrong label hides that the file was **never scanned**. Someone who reads "Couldn't read" may judge it a harmless OCR problem.
- Fix (in `pipeline-copy.ts`, so all screens agree): add `label` to `ProcessingView`. Scan step or `scanError` or `noResult` with scan: "Couldn't check". Read step: "Couldn't read". `noFile`: "No file yet" (already used for `uploading` in `storedPipelineLabel`). Use the same label in the tag, in the table and in `SPOKEN` (see S9). Keep the tone `major`.

### B3. "Turn off" on a dialog titled "Use the built-in check again?"
- State: 06 (light and dark). Evidence: capture, `processing-switch.tsx`.
- Sentence: the admin, when lowering protection, **reads the confirm button as "turn the antivirus off"**, which is the opposite of what the title says, and is the last thing read before clicking.
- Fix: the confirm button names the result: "Use the built-in check" and "Use your own antivirus" (reader: "Use the built-in reader", "Use your own reader"). Drop "Turn on / Turn off" everywhere. The spec text in R5.6 says "turning it on" (D1); update the spec wording with the button. Because this lowers protection, give the scan case the `destructive` variant, as Disconnect has; the reader case stays primary.

---

## Should

### S1. The upload card says "Adding 7 documents" for up to 30 minutes after everything was added
- State: 01. Evidence: `batchSummary` (`done` only when every file is ready or needs attention) and `upload-progress.tsx` (Dismiss only when `done`).
- Sentence: the uploader **waits up to 30 min** with a card that says Adding, a full progress bar and no Dismiss, fixed over the bottom right of the table. They may think the upload is stuck and add the files again.
- Fix: when all uploads have finished and only external waits remain, heading "7 added: 2 waiting, 5 need attention", no progress bar, Dismiss shown. The card keeps following the list. Treat `waiting` as its own batch state so "attention" and "done" stay as they are.

### S2. "Check now" gives no outcome
- State: 02 bottom (waiting line and the failed-refresh banner). Evidence: code (`list.refetch()`; button is `unavailable` while fetching).
- Sentence: the person, after pressing Check now, **doesn't know whether it worked** when nothing changed. A sighted person sees the button grey for a moment; a screen-reader user hears nothing (WCAG 4.1.3).
- Fix: after a manual check, show "Checked 14:32" in the line (and as `role=status` text). Auto polling does not update that text. On failure the banner already appears.

### S3. Turning on an own system when none is connected
- State: 04, 05. Evidence: capture.
- Sentence: the admin **turns on the reader with no reader connected, and every new file will fail after 30 minutes**. The warning is a plain paragraph with the same weight as the description, and the checkbox "I understand files will wait for this system" describes a system that does not exist.
- Fix: warning in a banner (warning tone) with a "Connect a system" link or button that closes this dialog and opens Connect; checkbox label in that case: "I understand files will fail after 30 minutes until a system is connected". Keep the confirm possible (decided), but not before the box is ticked.

### S4. Connect dialog: defaults do not match a scanner or a reader; ticking one silently unticks the others
- State: 08. Evidence: capture and `withScope`, `AddSystemDialog`.
- Sentence: the admin, when ticking "Check files for threats", **leaves System as "Order care (TMF622)" and the name as "Order care"**; that name is what everyone then reads in "Waiting for Order care". Also, ticking a processing permission clears everything else with no sign.
- Fix: choosing a processing permission, while the name still equals the kind default, sets kind "Other system" and name to "Antivirus" or "Reader" (editable). Add a visible and polled line when others were cleared: "Other permissions were cleared: this system can only check files." Move the helper "each need a system of their own" next to the two processing checkboxes, with a separator above them (they are exclusive; today they look like two more rows).

### S5. After Try again, Keep without reading or Report a problem, focus is lost
- State: card and panel. Evidence: code (`ProcessingNotice` returns `null` or re-renders; `UploadProgress` removes the button when the row moves to `scanning`).
- Sentence: the keyboard user, after pressing Try again, **loses their place**: the focused button leaves the DOM and focus falls to the page start (2.4.3, 3.2.x spirit).
- Fix: in the card, move focus to the row's file name (add `tabIndex={-1}` to the `li`). In the panel, move it to the notice container (`tabIndex={-1}`, `aria-label` "Processing") or to the first focusable control in the panel. Do this only after a user-triggered action, never from polling (the "focus never moves" rule in R5.5 stays true for announcements).

### S6. Viewers and non-editors at a failure get a dead end; the card and the panel disagree about Delete
- State: 01 and 02 (last notice, "Could not read, viewer"). Evidence: capture and code.
- Sentence: a viewer, at a failed file, **can't tell who can try again**. The only line says who can delete.
- Cross-state: the card shows a permanent grey Delete for people who cannot use it, plus the sentence; the panel shows no Delete and only the sentence. A grey permanent button teaches that the product is hostile; it is also a button the panel does not have.
- Fix: for people who cannot act, show no disabled Delete in the card; keep one sentence in both: "An editor can try again. A manager can delete this file." (only the parts that apply; omit sentence parts the person can already do). For managers, the panel notice has no pointer to the menu where Delete lives: add "Delete is in the menu above" or a Delete button in the notice. Only the second part reopens nothing: the decision is that Delete is offered; this only says where.

### S7. The card offers Report a problem without checking the role
- State: quarantined row in the card. Evidence: code: `ProcessingNotice` hides it when `!can(role, "review")`; `UploadProgress` has no role prop except `canDelete`.
- Sentence: a contributor **presses Report a problem and gets an error toast** where the panel would not have shown the button.
- Fix: pass `canReport`, `canEdit` like `canDelete` and filter `has("report")`, `has("retry")`, `has("keepUnread")`. Use the same `can()` calls as the panel so they cannot drift.

### S8. The system name is middle-truncated where there is room, and the cut is the useful part
- State: 01, 02, 09: "Acme Antivirus Ente…rise Gateway". Evidence: capture; 32-character limit in `pipeline-copy.ts`.
- Sentence: the person, with two systems whose names share a start and an end, **can't tell which one is meant**; the full name is nowhere on screen. The panel has the width.
- Fix: keep 32 in the narrow card and the table cell; in the panel notice allow the full name (up to the 80 the admin may type) and let it wrap. If the spec's 32 is a hard rule, say in the spec that it applies to the card and table.

### S9. What a screen reader hears differs from what is shown
- State: announcer. Evidence: `SPOKEN` in `pipeline-copy.ts`.
- Sentence: a screen-reader user hears "needs attention" where the screen says "Couldn't read", with no reason. The sighted person sees the reason when they open the file; they have to find it.
- Fix: speak the same label as the tag (B2) and add the reason for urgent ones: "Report.pdf: couldn't check. Acme Antivirus didn't answer in 30 minutes." Keep it short (system name truncated as on screen).

### S10. The disconnect and turn-off warnings are buried in running text
- State: 06, 07. Evidence: capture.
- Sentence: the admin **reads past** "protection is weaker" and "Files already waiting for it fail after 30 minutes" because they sit in the same grey paragraph as the boilerplate ("Its key stops working... Documents it added stay").
- Fix: split into two paragraphs; the consequence for files is the first, in main text colour with a bold lead ("Files waiting for it:" / "Protection:"). In 06, move "The change is recorded in the organisation's activity" to the end, in secondary colour.

---

## Nit (preferences, declared)

- N1. **Tooltip placement (09).** "Scan is simulated in this prototype." opens to the left of the tag and covers the "5 of 7 need attention – show them" link, running to the 1359 px edge. Place it below or above the tag. Check in `tooltip.tsx` that Esc dismisses it and the pointer can move onto it (1.4.13); I did not read that file. The trigger is a focusable `span` with no role; each built-in row adds a tab stop for a sentence. Consider putting the sentence in `aria-describedby` text on the row instead.
- N2. **Waiting has no end.** "Waiting for X · Since 14:25" never says it fails after 30 minutes (only admins read that). Add "Fails after 30 minutes" in secondary text in the panel. Preference.
- N3. **Failed refresh banner (02).** The title is a chip ("Can't refresh right now") with a blue info ring under `tone="warning"`; the body sits beside it and the button below. At 378 px it reads as a tag plus a note. Make the title heading-weight text; make the tone visibly warning, not info.
- N4. **Inner scroll in the card (01).** The list scrolls inside 288 px and the last row's buttons are cut at the card edge with no cue. Add a fade or show half a row less. Not measured at 768 px height in a real browser.
- N5. **Dark mode secondary text.** On the dark layer the waiting line, "A manager can delete this file." and the tag-adjacent copy are the dimmest text on screen. axe reports 0 violations, but I did not measure ratios from the PNGs. Measure `text-text-secondary` on the card layer and on the dialog layer; if under 4.5:1 for 12 px text, raise the token for `type-label-12`.
- N6. **Pending state (code).** While one action runs, every button in the notice is `aria-disabled` with no reason. It is short; fine, but name the running one ("Trying again…").
- N7. **Switch row (03).** The two action buttons have different widths, which makes a ragged right edge; the tag colours "Own system" green as if safer. Make both buttons the same width, and use a neutral tone for both modes (the choice is not good versus bad).
- N8. **Order of the Admin cards (03).** The switch sits under a list that can grow (12 or more systems per `ui-review-2026-11.md`). Put it above the list or add an anchor link "Own antivirus and reader" under the page intro.

---

## Cross-state drift check (done by hand from the images)

| Control or text | Card (01) | Panel (02) | Record table (code) | Drift? |
| --- | --- | --- | --- | --- |
| Failure label | "Couldn't read" for scan error | (heading is a gallery caption, see Questions) | "Couldn't read" | Same wrong word everywhere: B2 |
| Waiting line | "Waiting for X · Since 14:25" | same | same (full-width row) | None |
| Try again / Keep without reading | present | present | not offered (open the file) | Fine |
| Delete | grey Delete button for non-managers | not shown, sentence only | not shown | S6 |
| Report a problem | not role-gated | role-gated | not shown | S7 |
| Spoken state | n/a | n/a | "needs attention" | S9 |

No control moved or was renamed between light and dark: each pair of captures differs in colour only.

## Accessibility (WCAG 2.2 AA)

| Criterion | Finding | Fix | Counts in an ACR? |
| --- | --- | --- | --- |
| 4.1.3 Status Messages | Repeat failures not announced (B1); Check now has no outcome (S2) | see B1, S2 | Yes: a real failure of the criterion, even with axe at 0 |
| 2.4.3 Focus Order | Focus lost after a step action (S5) | see S5 | Yes |
| 1.4.13 Content on Hover or Focus | Tooltip dismiss and hoverable not verified (N1) | read `tooltip.tsx` | Verify |
| 3.3.1/3.3.3 Error | OK: copy gives the cause and the next step | none | no |
| 1.4.3 / 1.4.11 | axe 0; secondary 12 px text in dark not measured (N5) | measure | Verify |

axe passing does not cover announcements, focus after a removed control, or meaning in copy. It is a floor.

## Copy: before and after (en-US, sentence case)

| Where | Is | Proposal | Why |
| --- | --- | --- | --- |
| Tag, scan failures | Couldn't read | Couldn't check | The step that failed (B2) |
| Tag, never arrived | Couldn't read | No file yet | The file is missing, not unreadable |
| Dialog confirm, on | Turn on | Use your own antivirus / Use your own reader | Names the result (B3) |
| Dialog confirm, off | Turn off | Use the built-in check / Use the built-in reader | Names the result (B3) |
| Checkbox, no system connected | I understand files will wait for this system | I understand files will fail after 30 minutes until a system is connected | There is no system to wait for (S3) |
| Non-editor at a failure | A manager can delete this file. | An editor can try again. A manager can delete this file. | Who can do what (S6) |
| Card heading while waiting | Adding 7 documents | 7 added: 2 waiting, 5 need attention | S1 |
| Check now outcome | (none) | Checked 14:32 | S2 |
| Spoken failure | Report.pdf: needs attention. | Report.pdf: couldn't check. Acme Antivirus didn't answer in 30 minutes. | S9 |

One term per concept: the spec and copy use "own antivirus" (switch, dialog, panel) and "Your organisation's antivirus" (fallback in `systemName`); keep "your organisation's" for the unnamed system and "your own" for the switch, and do not use "scanner" in screen copy (only in the Connect dialog's key permissions, which are "Check files for threats"). I did not edit `docs/glossario-en.md`: this repository has none.

## Questions that suspend findings

1. In 02, are the headings above each notice ("Waiting", "Scan got no answer", "Could not read", "Blocked", "Could not read, viewer") part of the product panel or captions added by the gallery? If product: "Could not read" differs from the tag "Couldn't read", "Blocked" from "Blocked for safety", and "Scan got no answer" is a third phrase for the same state (this would add a drift finding). "Could not read, viewer" is clearly a caption.
2. The captures show the dialog scrim ending at y = 768 (the page below is bright in 04 to 08). I treat this as a full-page capture artefact (the overlay is as tall as the viewport). Confirm in a viewport screenshot at the bottom of the page; if real, it is a **should** for the dialog component.
3. Should turning on a system with none connected stay possible (S3)? I kept the decided behaviour.

## Limits of this review

- Captures and code only; the app was not run, no screen reader, no keyboard walk. Focus findings (S5) come from code.
- Not read: `tooltip.tsx`, `dialog.tsx`, `banner.tsx`, `document-panel.tsx`. Statements about them are marked as to verify.
- The record table row is not in the captures; it is judged from `records.$entityId.tsx`.
- Waiting-line truncation was judged at 380 px only (card and panel).
- Spec section R5 was read in `requirements.md`; the repository's search tool returned no matches, so I read files directly and may have missed other users of `pipeline-copy.ts`.
- No load numbers were asked about: one wait up to 30 minutes per file; many files waiting at once was not reviewed (the card list scrolls, the list refetches once).

## Response (round 2)

Answers to the questions: the headings in capture 02 are gallery captions, not product text; the scrim ending at y = 768 is the full-page capture of a viewport-high overlay.

Fixed, each with a component or rule test: B1 (one keyed element per announcement, removed after 5 s, the same failure twice is two announcements), B2 (`ProcessingView.label`: "Couldn't check", "Couldn't read", "No file yet", used by the card, the panel, the record table and the announcer), B3 (confirm buttons name the result; lowering the scan to the built-in check is destructive), S1 (a file waiting for an outside system counts as added: "1 added: 1 waiting", Dismiss shown), S2 ("Checked HH:mm" as a status after Check now), S3 (warning banner and a checkbox that says files fail until a system is connected), S4 (a processing permission names the system Antivirus or Reader unless the name was changed; the cleared permissions are said; the two processing permissions are grouped under their rule), S5 (focus returns to the row in the card and to the document heading in the panel, after a person's action only), S6 (no disabled Delete; one sentence for what the person cannot do; managers are told Delete is in the menu), S7 (the card filters actions by edit and review rights like the panel), S8 (80 characters in the panel), S9 (spoken words are the tag plus the first sentence of the message), S10 (the consequence for files is the dialog's description; the boilerplate follows), N2 (the panel says when a wait fails), N6 (the running action is named), N7 (neutral tags).

Round 2 captures (gallery, 1366 wide, light and dark, 9 states): axe-core 4.10 WCAG 2.2 AA, 0 violations in each; no console errors.

Left, with reasons: N1 (tooltip placement belongs to `tooltip.tsx`, shared by every screen), N3 (Banner is the shared EDS banner), N4 (the card's scroll predates this work), N5 (secondary text contrast is a token decision for all screens; measure with the next token review), N8 (card order: the switch is used once, the list daily). A person must still check the announcements with a screen reader (R5.7).
