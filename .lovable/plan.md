# Make document review clear: one guided path from "check details" to "approved"

## What the review panel found

Panel (simulated): an Apple-style interaction designer, a visual designer, an accessibility specialist, a content designer, and two telecom specialists (order care/CPQ and contract compliance). The review walked through the quote Q-2026-0412 as the Sweden manager, at 1280px wide and at your current 792px window.

1. **Two different things are both called "review".** The status says "In review" or "Awaiting approval". The link says "Review details". The page is titled "Check details", and its button says "Close review". People can't tell whether checking details *is* the approval or comes before it.
2. **The check page is a dead end.** Once every detail is checked, nothing points to the next step. You have to close the page, find the document again and look for Approve.
3. **Finished details look unfinished.** Accepted details still show Accept / Edit / Reject at full strength, and the orange "Low confidence" warning stays on. The screen reads as "work left to do" when there is none.
4. **Numbering fights the page.** Detail [2] appears above [1] on the document, and the bracket numbers look like footnotes. Confidence is a label with no reason behind it.
5. **"Reject" is ambiguous.** It could mean the value, the field or the whole document.
6. **Smaller windows hide the work.** At 792px the document fills the whole screen and the details (with their buttons) are pushed out of view.
7. **Constant shortcut text adds noise.** It always says "Ctrl", even on a Mac.
8. **Telecom context is missing.** Reviewers can't see whether a read value agrees with the record: the quote number against the CPQ quote, the order number against Order care, or the customer and VAT number against CRM. They also can't see which details are contract-critical (price, term, sites, service level) and which are informational.
9. **Statuses disagree.** The record header says "Awaiting approval" while its only document is "Effective".

## What we'll change

**A. One named journey, shown everywhere.** A small three-step guide reads "Check details → Approve → Effective", with the current step highlighted. It appears in the document panel and on the check page. Naming is consistent: "Check details" for the field work, and "Approval" for the decision. "Close review" becomes "Back to document".

**B. The check page finishes the job.**
- **Persistent footer:** a bar along the bottom shows "2 of 5 checked" and the main action. It reads "Next detail" while details remain, then "Approve document" once all are done, for people allowed to approve. For everyone else it reads "Send for approval" or "Done".
- **Clear outcome:** when everything is checked, a short confirmation summarises what happened, e.g. "4 accepted, 1 corrected".

**C. Calm, clear detail rows.**
- **Pending detail:** shows the value, where it was read on the page, and a plain reason for the confidence (for example, "Characters were hard to read" or "Matches the record").
- **Main actions:** "Confirm" (primary) and "Correct". Reject becomes "Not in this document", inside a small menu.
- **Checked detail:** collapses to one line with a tick, who checked it and when, and a quiet "Change" link. The low-confidence warning disappears once someone has confirmed the detail.
- **Numbering and order:** numbers become small circles matching the page markers. Details are ordered by where they appear on the page, and "Next detail" still jumps to the most uncertain one.

**D. Telecom checks next to each value.**
- **Record checks:** a "Matches record" or "Differs from record" note against the linked order, quote, account or customer. For example, quote number vs the CPQ quote ID, order number vs the Order care order, and the VAT number and customer name vs CRM.
- **Format checks:** for Swedish and Norwegian VAT and organisation numbers, dates, and currency amounts.
- **Contract-critical details:** marked as such and sorted first. Approval can't skip them.
- **Four-eyes:** the person who added the document can't approve it. The reason text says so. (I'll confirm whether this rule already exists before building it.)

**E. Works on smaller windows.** Below 900px, the page and the details become two tabs: "Details" (default) and "Document". Choosing a detail jumps the "Document" tab to its marker. The footer stays visible.

**F. Shortcuts on demand.** A "Keyboard shortcuts" button opens a small list. It shows ⌘ on a Mac and Ctrl elsewhere. Shortcuts: J/K to move between details, C to confirm, E to correct.

**G. Fix the status mismatch.** The record header will show the status of its current approved document, or "No approved document yet". It won't show a status that contradicts that document.

## How we'll check it
- **Tests for the rules:** journey step, footer action, confidence reason, record-match outcome, contract-critical ordering, and the four-eyes gate.
- **Browser run:** as the Sweden manager and the viewer, at 1280px and 792px, in light and dark mode. The run checks a document from first detail to approval in one flow, with no page changes.
- **Regression:** re-run the share-isolation browser test so nothing leaks through the new record-match notes. The notes show only "matches" or "differs" and never another record's values.

## Technical details
- **Pure rules:** `review-rules.ts` gains `journeyStep`, `footerAction`, `confidenceReason`, `recordMatch` (compares against fields the record already exposes), `isContractCritical` (from the document type's definition) and `pageOrder`. All are tested in `__tests__/review-rules.test.ts`.
- **New components in `src/components/review/`:** `review-journey.tsx`, `review-footer.tsx` and `field-row-checked.tsx`. Simplify `field-row.tsx`, and add tab layout in the review route below 900px.
- **Approval:** reuses the existing transition call and the approve gate. The approve button is built from `document-actions.ts`, so gating stays identical to the panel.
- **Four-eyes:** add it to `document-rules.ts` and the server transition check only if it isn't already there.
- **Record status:** the record header's status is derived from `approved-summary.tsx`'s current document.
- **Scope:** no new libraries; English only.
