# Accessibility

## Standard

The target is WCAG 2.2 level AA, which is what the Ericsson Design System (EDS) asks products to meet. The app already uses EDS-style tokens (colours, type scale, focus ring) through CSS variables, so the look follows EDS without using the EDS component library. Keep it that way: Lovable generates shadcn/Radix components, and replacing them would break the preview.

## How it is checked

- Automated: an axe-core scan with the WCAG 2.0, 2.1 and 2.2 A and AA rules, run in a browser against the pages and their states: documents, shared, holds, the three admin pages, the open document panel, the edit dialog, and rows while hovered. Last run: no violations in those states.
- Hovered rows matter: a row that changes background on hover can drop its secondary text under 4.5:1. `src/test/hover-contrast.test.ts` keeps the fix in place.
- axe finds roughly a third of the problems. It cannot judge whether labels make sense or whether the keyboard order is logical. Before a release, walk the main flows with the keyboard alone and with a screen reader.

## Known notes

- Menus are not modal (`modal={false}`), so the page behind an open menu is not hidden from assistive technology; the earlier `aria-hidden-focus` finding is gone. Escape closes a menu and returns focus to its button. `src/components/erad/__tests__/menus-not-modal.test.ts` keeps it that way.

- Status colours (the EDS greens, reds and ambers) are for icons, borders and stripes, never for text: as text they fall under 4.5:1. The review page's "All details checked" line was fixed this way.
- The review page lists the details read from a document as a listbox whose options contain buttons and inputs. Options should not hold interactive content. The fix is to make the rows a plain list with their own focus handling; it changes how the keyboard moves through the review, so it needs a person to test it with a screen reader before it ships. The automated scan now covers this page with every row selected in turn: no violations.

- With a dialog open over a coloured row (for example "Choose a record" over a selected document), axe reports `color-contrast` on the page behind the dimmed backdrop. Every reported node is inside the background that the dialog marks `aria-hidden` and that cannot be reached by pointer or keyboard while it is open: inactive content, which WCAG 1.4.3 exempts. Scan the dialog itself with `axe.run({ include: ['[role="dialog"]'] })`; it has no violations in either theme.
- Adding documents from the Documents page (2026-11-18): the accessibility tree was checked step by step in the browser (dialog names, field label and helper, live status, result buttons, focus on "Choose files", focus back in the field after "Choose a different record", focus on Add documents on arrival). Still to do by a person with VoiceOver or NVDA: that the status line is announced while typing, that the step change from "Choose a record" to "Choose the files" is announced, and that the arrival hint is read with the focused button.
- A skip link ("Skip to main content") is the first stop in the app shell and moves focus to `<main id="main-content">`. Field errors are also rendered as an `alert` element when they appear, so a failed log in is announced without moving focus. Both are checked in the browser (focus order, element present) and by unit tests; a person with VoiceOver or NVDA still needs to confirm how they are read.
- Every dialog dims the page behind it (60%, the EDS value) and keeps focus inside; closing returns focus to what opened it.
## Adding documents and the EDS file upload pattern
Where "Add documents" differs from the EDS file upload pattern, and why (R25):
| EDS pattern | Here | Why |
| --- | --- | --- |
| A drop area with a link to open the file browser | An "Add documents" button; dropping or pasting anywhere on the record page | Records are long lists; a fixed drop area would push the documents down. The button is a single, keyboard-reachable target; dropping stays available everywhere on the page. |
| Upload starts when the files are dropped or chosen | A type step first: each file gets a document type, and files the type does not accept are flagged before anything is sent | A document without a type cannot be kept or checked; refusing a wrong file before upload avoids a failed document. |
| Progress per file with percentage and amount | One progress bar for the batch, then a line per file with its state (uploading, scanning, reading, ready, or the problem) | Files are small; what people wait for is scanning and reading, which have no percentage. |
| Cancel ("x") and retry (refresh icon) per file | "Cancel" while a file waits, "Try again" for a failed upload, "Retry" or "Keep without reading" when reading fails | Text buttons say what happens; the reading step has two ways forward, which an icon cannot tell apart. |
| Finished files shown as removable pills | Finished files join the record's documents table with a "Ready" tag; removing one is "Delete" in its panel | An added file is a document with history and access rules, so it is deleted like any document, not dismissed. |
## When you add a screen

- Every control has a name; every input has a visible label.
- Do not carry meaning by colour alone: statuses show a word as well.
- Secondary text on any coloured or hover background must reach 4.5:1.
- Everything reachable by mouse is reachable by keyboard, with a visible focus ring.
