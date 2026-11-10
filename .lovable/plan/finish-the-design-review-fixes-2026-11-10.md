# Finish the design review fixes

The review's seven quick fixes are already done, and search across all documents was rebuilt on the Documents page. This plan covers the remaining items.

## 1. Lead with the approved version (record page)
- At the top of each record, show a quiet card titled "Current approved version". It shows the newest approved or effective document: name, type, version, date and an "Open" button.
- If there are several (e.g. a contract plus an order form), show up to 3, then "and N more".
- If none exists, show one calm line: "No approved document yet". If a document is in review, add "· 1 in review" with a link to open it.
- Everything else stays in the list below. The highlighted documents stay in the list as well.

## 2. Calmer selected row
- The open document's row changes from solid blue to a soft blue tint with a 3px blue bar on the left. Text stays its normal colour.
- This uses the existing table-selection colour (light and dark), so no new colour is needed. The same look is used everywhere a row can be opened.

## 3. A quieter document panel
The panel is reorganised into three sections with small headings:
- **Status and next step:**
  - Status and hold tags, and the version line.
  - The "to check" notice.
  - The main next-step button with its reason, plus "Send back" when it applies.
- **Details:** the existing details block.
- **Activity:** the latest 5 entries, with "Show all".

One "…" menu in the panel header holds:
- Manage access
- Why can I see this?
- Report a problem
- Place or release legal hold
- Delete
- Delete permanently (admins only)

The old "More" fold-out goes away.

Actions that aren't available stay in the menu, shown dimmed with their reason on a second line, so keyboard and screen-reader users still reach the reason. The shared-only view shows only the menu items that apply to it.

## 4. Clear "Approve" when it can't be used yet
- Instead of the grey block, show an outlined button with a small lock icon. Beside it goes the reason, e.g. "2 required details still to check", plus a "Review details" link.
- Other next steps that aren't available get the same treatment, for example a viewer seeing "Send for review".

## 5. Readable admin table (Document types)
- By default the table shows only Name, Where defined and Retention.
- Code, signature, review, personal data and business process move into the side panel that opens when you pick a row. Most of these are already shown there; any that are missing get added.
- The table gets a calm header, a little more space per row, and the softer selected row from item 2.

## 6. Larger confidence tags on "Check details"
- The High/Medium/Low tags move to the standard tag size (24px tall, 14px text) with their icon. Long rows wrap neatly at narrow widths.

## Checks
- Browser walk-through as the Sweden manager, viewer and admin, at 1440 and 800 wide, in light and dark.
- Covers the record page, an open document, the "…" menu by keyboard, gated Approve, admin document types and Check details.
- The share-isolation test runs again, so menu changes can't reveal record details in shared-only view.
- Existing tests and the typecheck must stay green. A new PDF with before/after screenshots goes to Files.

## Technical details
- New `src/components/documents/approved-summary.tsx`. It reads the record's already-loaded list and picks approved/effective documents. That selection is a pure tested helper in `src/lib/` or `src/services/document-actions.ts`.
- `document-panel.tsx` is split into section components to stay under 300 lines. A new `document-menu.tsx` uses the existing shadcn dropdown with ERAD styling. Menu items for unavailable actions use `aria-disabled` with the reason as a description, following the project rule.
- `DocumentActionsBar` keeps the dialogs and the next-step logic, with the "More" details removed. The dialogs open from the menu through a shared state hook.
- Selected row: `bg-cell-selected` plus a `border-l-[3px] border-border-selected` inset on the record list and `DataTable`.
- `Button` gets an outlined unavailable style for `variant="primary"`, for the gated next step only. Other buttons stay unchanged.
- `spec-table.tsx` columns are reduced to three, and `spec-panel.tsx` is checked for the moved facts.
- `field-row.tsx` drops `small` on the confidence tag.
