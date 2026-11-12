# Check details

- **URL:** `/records/{entityId}/review/{docId}`
- **Who:** reviewers and above with record access (others read only: "Only reviewers and managers can check details. You can still read them.")

## Purpose
Guided confirmation of details read from a document before approval.

## Layout and actions
Left: page preview with numbered markers (page order BR-033), zoom. Right: "Details read from the document". Pending rows show value, plain reason (BR-039), source line, Confirm / Correct, and "Not in this document" under the … menu; contract-critical rows are tagged "Needed for approval". Checked rows collapse to one line with a tick, the time, and Change. Sticky footer "N of M checked" with progress and the action from BR-025 (Next detail → Approve document → Back to document) and its reason. Outcome per BR-026. Under 900 px: tabs **Details** / **Document**; choosing a marker jumps to Details. Keyboard: J/K or arrows to move, C confirm, E correct, N next, active only while the details list has focus (the dialog says "These work when the list of details has focus. Nothing is confirmed automatically."); listed under **Keyboard shortcuts**. Esc returns to the document, except while a value is being corrected or a dialog, menu or select is open (the prototype's window-level Esc does not guard the row menu). Page pane: "Zoom out" / "Zoom in" (75–200 %; at a limit the percentage is the visible reason), "Page N of M". Row tags: "Needed for approval", "Differs from record", "Matches record", "High/Medium/Low confidence"; checked rows read "Confirmed" / "Corrected" / "Not in this document" · time · Change. BR-041 ("Edited – read as <Band>: <original>") exists in `review-rules.ts` but no component renders it; whether the rebuild shows it is the owner's decision.

## States
Loading: "Opening the details" / "Loading the page". Frozen: "This document is closed, so its checked details are kept as they are." Approved (content protected, BR-143): "This document is approved, so its checked details stay as they were approved." Read-only role: "Only reviewers and managers can check details. You can still read them." Empty: "Nothing to check here" / "No details were read from this document, so you can go straight to approval."; footer "No details to check". Error: "We couldn't open the details just now." + Try again. Not visible: "This document isn't available to you" / "It may have been removed, or your access has changed." + "Back to the record". Page not available (prototype only): "This page can't be shown in the prototype. The details on the right can still be checked."

## Accessibility
- The details list is a plain list with roving focus on rows, not `listbox`/`option` (options cannot contain the Confirm, Correct, "…" and Change controls; the prototype does this, `field-row.tsx:56,78`). One Tab stop moves between details, then Tab reaches the row's buttons.
- Single-key shortcuts fire only while the list has focus (WCAG 2.1.4); see Layout.
- The sticky footer never covers the focused row (scroll margin equal to the footer height); "N of M checked" is a live region.
- Unavailable actions show their reason: the footer action per BR-015/021/022 in that order; "Save correction" needs a typed value (the prototype shows no reason, `field-row.tsx:110`); while saving, buttons read "Saving…".
- The selected row and marker use the selected-border and `fill-cell-selected` tokens, not the focus purple (the prototype's marker is `text-on-primary` 12 px on `bg-focus`, 3.77:1 light, 2.76:1 dark); the outcome line is `text-main`, not `text-status-cleared` (3.46:1).
- "Back to document" returns focus to the "Check details" link that opened the page.
- Dialogs return focus to the control that opened them. Targets are at least 24 px. Status is never shown by colour alone.

![Check details](img/review-1280.png)

![Check details](img/review-792.png)
