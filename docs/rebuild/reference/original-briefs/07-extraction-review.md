# Prompt 07 – Screen 4: extraction review (own design – no vendor shows this; evidence in docs/research/usability-round1-plan.md)

Read AGENTS.md, contracts/model/extraction-field.schema.json, contracts/model/document-specification.schema.json, docs/ui-references.md (Mistral 9d1334ff two-column; Dovetail b0539367 numbered citations). Plan first, wait for OK.

Build "Check details" for documents whose type has extractable details (seeded: the Fjärrvärme Syd contract in review and the quote d2; the Nordlys contract is fully checked and shows the "all checked" state).

**Entry.** In the preview panel, below the key facts, a banner appears when pending fields exist: "{n} details read from this document need checking." with a default button "Review" (the person starts it, so no AI gradient; the gradient marks AI-initiated actions only). The table shows the badge "{n} to check" under the Status tag. Counts are always **pending fields**, computed from data.

**One vocabulary** (use these words and no others): a field's state is **"Not checked yet"**; counts are "{n} to check" and "{k} of {n} to check"; the Approve reason is "{r} required details need checking"; key facts say "Not checked yet – see page 1". "Needs attention" is only for table rows (failed, quarantined, expired, on hold). Never "Unconfirmed", "pending" or "still".

**Layout** (1440 and 1920): left 60 % = document page (from `sample_pages`) with page navigation and zoom; right 40 % = field list. Below 900 CSS px wide (200 % zoom) stack page above fields. "Close review" returns to the preview panel with focus on the Review button.

**Field row** (min 48px, values wrap and are never truncated):
- Human label, not the code: contractNumber → "Contract number", counterparty → "Other party", endDate → "End date", renewalType → "Renewal", renewalTermMonths → "Renewal term (months)". Dates as "31 Dec 2029".
- Value; for fields not checked yet the excerpt is shown **inline by default**, not only on selection: "Read from page 1: 'End date: 31 December 2029'", and the state "Not checked yet".
- Confidence band as a tag with words **High confidence / Medium confidence / Low confidence**: tones High → `cleared` with check-circle, Medium → `indeterminate` with info, Low → `major` with warning-triangle (never `critical`: Low is not an error); numeric score only in the tooltip.
- Status: Pending / Accepted / Edited / Rejected.
- Actions as **text buttons** (not icon-only): Accept, Edit, Reject.
- Selecting a row highlights its source box on the page (2px border plus a numbered marker "[1]" matching the row, so the link is not colour alone) and scrolls it into view; clicking a highlight selects the field.

**Rules** (server-enforced by `reviewExtraction`):
- Accept → accepted. **Edit**: the value becomes a field; Enter or "Save" commits, Esc cancels; while editing, single-key shortcuts are off. Edited counts as reviewed, keeps `original_value` and the original band, and shows "Edited – read as High: Fjärrvärme Syd AS". Reject → rejected; the value is not copied to the document.
- Accepted/edited values are written to the document's `characteristic` by the server with an audit event ("Field End date accepted"), never with the value in `detail`.
- **Never auto-accept** in the prototype, whatever the score.
- Default order: Low, Medium, High, so risk comes first. **"Next to check"** button and shortcut N (Shift+N previous) jump to the next unchecked field; Ctrl+Enter accepts (or, while editing, saves) and moves to the next unchecked field. N, Shift+N and Ctrl+Enter work only while focus is inside the field list (`role="listbox"`); Esc in the review means "Close review". Above the list: "{k} of {n} to check".
- **Bulk accept**: one secondary button "Accept N High-confidence fields" (correct singular/plural), only High, excluding fields marked `alwaysReview` and `spot_check`. There is no "Accept all". Bulk accept is undoable as one batch.
- **Always checked**: characteristics with `alwaysReview` (contract number, end date) show the tag "Always checked" and are never bulk-accepted.
- **Spot check**: only fields with `spot_check = true` in data show "Spot check" and stay pending (deterministic; never random in the prototype). Record their outcome separately in the audit.
- Thresholds: band cut-offs come from the tenant (locked by the master in the seed); a characteristic may set a stricter `reviewThreshold`. Reviewers never see threshold numbers.
- **Approve gate** (server-enforced in `transition`, mirrored here and in the preview panel): if a required detail has no accepted or edited value, Approve is `aria-disabled` with the visible reason "{r} required details need checking". When Approve is enabled but optional details are unchecked, show "{o} optional details not checked yet. You can still approve."
- **Undo** stays on the row ("Accepted · Undo") until the next action on that row – no timed toast (WCAG 2.2.1).
- **Problem with the whole document** (separate from rejecting a field): "Send back" (seam `reportProblem`, kind sendBack) with a reason (wrong document, wrong order or account, unreadable pages, other + comment ≤ 280 characters). Allowed only while In review: it returns the document to Draft (the one backward transition) and closes the review with "Sent back: wrong document". Next to it: "To fix one detail, use Edit."
- KYC outcome documents (storesPersonalData): outcome fields only; no page preview; "The original document stays with the verification provider."

**AI honesty copy** above the list: "These details were read automatically and can be wrong. Check each one against the page." No accuracy claims. Scores are stored for audit (note in the Activity tab).

**States:** all pending, mixed, all reviewed ("All details checked. You can approve this document." with Approve if allowed), none found ("No details were read. You can enter them by hand." with a form), extraction failed (reason + retry), read-only role (view only, reason shown), tenant with extraction disabled (hide banner and badge).

Verify at 1440 and 1920, light and dark, at 200 % zoom (stacked layout), keyboard only, and report in one line.
