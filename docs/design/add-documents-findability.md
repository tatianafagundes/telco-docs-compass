# Spec: make "add documents" easy to find

Status: built 2026-11-18 and reworked the same day after review by design-review and ux-researcher (heuristic, no users). The dialog now has two steps: choose the order, quote or account, then choose the files (the picker opens from that click, so there is no second "Add documents"); the files are handed to the record page in memory, which opens the type step at once. "Choose a different record" is in step 2, in the arrival hint, and back after cancelling the type step. Contrast hits behind the dimmed dialog are inactive content (see `docs/architecture/accessibility.md`). Open: a usability test (task 3 of the UX plan) and a screen-reader pass by a person. Flow B in the table below is the one built.
Scope: three UI changes, no new database work. No code in this file.

## Why

Upload exists only on the record page. Almost nothing leads there: the "Go to X" shortcut under the search (only when the query looks like a record number), Shared with me, and the manage-access dialog. People who have files and are on the Documents page have no visible way to add them.

The three changes give three routes to the same place:

1. From a document: the side panel links to its record.
2. From the results list: the Record column links to the record.
3. From the page header: an "Add documents" action that helps you pick the record.

## How I judged this

There is no DESIGN.md. The ruler is `AGENTS.md`, `docs/architecture/accessibility.md` (WCAG 2.2 AA), `src/styles/tokens.css` and the screens that exist today. Note that tokens.css says it is generated from a DESIGN.md that is not in the repo. Worth knowing before anyone edits tokens by hand.

Verified by reading the code: the files named below, `findRecord` in `src/services/search.functions.ts`, `Dialog`, `Button`, `TextField`, `PageHeader`, `SidePanel`, `app-shell.tsx`, `src/styles.css`, `src/services/document-actions.ts`.
Not verified: nothing was run. I could not search the repo with grep (it returned nothing, even for strings I had just read), so I could not confirm every place `DocumentPanel` is used. Check with a search before shipping change 1.

## Facts from the code that shape the design

- The Record column is `hidden 2xl:block`. 2xl is 1536 px. The nav is already collapsed below 1280 px and the side panel takes 356 px. On a 1366 px laptop, which is the common case, nobody sees the Record column today. So the small-width layout is the main layout, not an edge case.
- The table gives the record name only when the person can read it: `entity_name` is null otherwise. `open()` only passes `rec` when `entity_name` is set. Keep that rule everywhere.
- `findRecord` matches the record id exactly (case-insensitive) or the name from its first letter (`display_name ilike q%`). It returns at most 5, in no defined order, and strips `% _ \ , ( )` from the query. It does not match the middle of a name. "Fibre" will not find "O-7731 Fibre upgrade". The dialog copy must say so.
- `findRecord` is `min(2)` characters and `max(64)`.
- `RECORD_KIND` in `records.$entityId.tsx` knows 4 types (Quote, ProductOrder, Account, Customer). `ENTITY_TYPES` in `search-rules.ts` lists 7 (adds BillingAccount, Agreement, TroubleTicket, Site). The record page falls back to the raw code, so "BillingAccount" would show on screen.
- `Dialog` focuses the first tabbable element when it opens. That is the Close button, not the search field. It also has no height limit: at 400% zoom a tall dialog is clipped above and below with no way to scroll to it.
- Link blue on hover fails contrast in the table. `text-link` on `item-hover`: light about 4.0:1 (#0069c2 on #dcdcdc), dark about 2.5:1 (#008cff on #4e4e4e). Both are under 4.5:1. This is the same trap `src/test/hover-contrast.test.ts` guards. In the panel (`layer-content` background) `text-link` is fine: about 5.3:1 light, about 4.6:1 dark.
- The Start lists (`start-lists.tsx`) also print the record name as plain text inside a button row. A link cannot live inside that button. Out of scope here. The panel link covers it, because Enter on a start row opens the panel.

## Shared prerequisites (build these first)

| # | Change | Where | Why |
|---|---|---|---|
| P1 | One function for record kind names. Move `RECORD_KIND` out of the record route into a shared place and cover all 7 types. Unknown codes are humanised like `typeLabel` does ("TroubleTicket" becomes "Trouble ticket"). | `src/lib/document-labels.ts` | Panel, table, dialog and record page must say the same word. "One concept, one term." |
| P2 | `addDocumentsState(role)` returning `{ available, reason }`. Reason text: "Viewers can open documents here but can't add them." Use `can(role, "edit")`. The record page's existing text and toast use this too. | `src/services/document-actions.ts` + test next to the existing ones | AGENTS.md says reason text for unavailable actions comes from this file. Two pages must not drift. |
| P3 | `Dialog` accepts `initialFocusRef` (focus it in `onOpenAutoFocus`, after `preventDefault`) and gets `max-h-[calc(100vh-32px)] overflow-auto` on the content. | `src/components/erad/dialog.tsx` | Search field must get focus on open. Dialog must be usable at 400% zoom (WCAG 1.4.10). Existing dialogs benefit; check they do not change. |
| P4 | `useRecordSummary(entityId)`: wraps `api.findRecord(entityId)`, enabled only when `entityId` is a non-empty string, picks the row whose `id` equals `entityId` (case-insensitive), key `["records","summary",entityId]`, `staleTime` 5 minutes. | `src/hooks/use-document-search.ts` (next to `useRecordMatches`) | `findRecord` is a prefix search, so the first row is not always the record. |
| P5 | Record route accepts `add`: `z.literal(1).optional().catch(undefined)`. | `records.$entityId.tsx` `validateSearch` | `?add=1` must not break the page when someone edits the URL. |

Known weak spot in P4: if a record id contains `_`, `%`, `,` or brackets, `findRecord` strips them and the lookup misses. The panel then shows the "can't access" sentence for a record the person can open. I could not see the id format. Developer: check real ids. If any contain those characters, add `getRecord(id)` (exact `eq` on id, same RLS) instead of using `findRecord` for this. Everything below stays the same either way.

---

## Change 1. Record link in the document panel

### Placement

In `DocumentPanel` `headerBlock`, directly under the status tags, in the slot where the "Part of a record you don't have access to" line sits now. The two never show together.

```
Quote_Fibre_upgrade_v3.pdf              (h3, existing)
[Draft] [Ready]                          (tags, existing)
Order · O-7731 Fibre upgrade             <- new link, label-12
Version 2 · 14 Nov 2026                  (existing)
```

Component: `RecordLine({ entityId })` in a new file next to `document-panel.tsx` (keeps the panel file from growing).

### Link

- Text: `{kind} · {name}`, for example "Order · O-7731 Fibre upgrade". The whole text is the link, so its name is complete when read alone from a links list.
- Target: `/records/$entityId` with no search params. The panel state lives in the URL (`doc`, `rec`), so Back returns to the same results with the panel open.
- Style: `focus-ring type-label-12 text-text-link underline underline-offset-2`. Underline is needed because the link sits in a block of text and colour alone is not enough (1.4.1).
- Target size: `flex min-h-6 items-center`. 24 px tall meets 2.5.8. Full width of the panel column, so the hit area is wide.
- Long names: the text wraps and stops at 2 lines with an ellipsis. Use `[overflow-wrap:anywhere]` so a long id with no spaces cannot push the panel wider. The accessible name is always the full text.
- The record page does not need this line (the page header already says it). `DocumentPanel` gets `showRecord?: boolean`, default `true`. The record route passes `false`. The shared route passes `entityId={null}` as today.

### States

| State | What shows | Notes |
|---|---|---|
| `entityId` is null (direct share) | "Part of a record you don't have access to" (existing text, unchanged) | No request is made. No kind, no name, no link. Test must assert zero calls to `findRecord`. |
| Loading | Nothing visible. The line keeps `min-h-6` so the panel does not jump. | No spinner for a single line. |
| Found | The link above | |
| Not found (empty reply) | "Part of a record you don't have access to" (same existing text) | Under RLS "deleted" and "no access" look the same, so one sentence covers both. |
| Error | "We couldn't load the record just now." and a text button "Try again" (`label-12`, underline, `min-h-6`, same pattern as "Show all" in the activity list) | Matches the wording of the panel's own error. Button refetches. |
| Viewer | Same link | Reading is allowed for every role. |
| Shared-only document with a readable record | Not applicable: shared routes pass null. | Matches the AGENTS.md rule that direct shares must not leak record details. |
| Record page | Line not rendered (`showRecord={false}`) | |

### Keyboard and focus order

The link is a normal tab stop. Order inside the panel: collapse button, document actions bar, then this link is reached after the tags, before the version line and "Check details". No new key handling. Enter follows the link.

### Screen reader

- Link name: "Order · O-7731 Fibre upgrade". No extra `aria-label` (it would have to repeat the visible text, 2.5.3).
- The error text is plain text, not a live region. It appears with the panel.

### Light and dark

Uses `text-link` on the panel background only. Both themes are over 4.5:1 (computed from tokens.css; confirm with the axe scan). Do not reuse this class in table rows (see change 2).

### Acceptance criteria

1. Opening a document from the table with a visible record shows "{kind} · {name}" as a link to `/records/{id}`.
2. Opening `/shared/$docId` shows only "Part of a record you don't have access to". `findRecord` is not called. No kind or name appears in the DOM, including `title` and `aria-*`.
3. When `findRecord` returns an empty list, the "can't access" sentence shows and no link renders.
4. When `findRecord` returns several rows, the one whose `id` equals `entityId` is used. If none equals it, the "can't access" sentence shows.
5. On `/records/$entityId` the line is absent.
6. A 120-character name without spaces wraps inside the 356 px panel with no horizontal scroll.
7. Axe scan of the open panel in light and dark: no violations.
8. Kind comes from the shared helper: `BillingAccount` shows "Billing account", an unknown code such as `FooBar` shows "Foo bar".

---

## Change 2. Record link in the results table

### Decision: how a link works inside a grid row

The row is the one tab stop (roving tabindex). Enter opens the panel. Space ticks. A click on the row opens the panel. The link must not change any of that.

| Input | Behaviour |
|---|---|
| Mouse, plain click on the link | Goes to the record. Does not open the panel and does not tick. The link's `onClick` calls `stopPropagation()` (the checkbox cell already does this). |
| Ctrl, Cmd, Shift or middle click | Browser default (new tab or window). Row does not react. It must be a real `<a href>` via the router `Link`, so "copy link address" works. |
| Tab | The link has `tabIndex={-1}`, the same as the checkbox. The grid stays one tab stop. |
| Enter on the row | Opens the panel, as today. |
| Space on the row | Ticks, as today. |
| Right arrow on a row that has a visible record link | Moves focus to that link. |
| Enter on the focused link | Follows the link. |
| Left arrow or Escape on the link | Focus goes back to the row. |
| Up or Down arrow on the link | Moves to the previous or next row (same as from the row). |
| Tab from the link | Leaves the grid forward, as from a row. |

Why this and not something simpler: a link with `tabIndex={-1}` and no way in is a mouse-only control, and the accessibility rule is that everything reachable by mouse is reachable by keyboard. The panel link (change 1) is the guaranteed keyboard and screen reader route: Enter, then Tab into the panel. The Right arrow is the faster route for people who know the grid. If the Right-arrow code is cut for time, ship without it. Change 1 still satisfies the rule. Do not ship a link that is mouse-only and has no panel link.

Required guard in `onKey`: handle keys only when the event target is the row itself (`e.target === e.currentTarget` of the row, or `dataset.row` is set). Today the `Enter` branch has no such check. Once a link inside the row can hold focus, Enter on the link would be swallowed: `preventDefault()` and open the panel instead of navigating. This is the one bug this change can introduce. Test it.

Hover and focus on the link never change `focus` state in a way that breaks roving: the row's `onFocus` already bubbles from children and sets the index. Keep that.

### Layout, two sizes

Row height stays 56 px (no loss of density).

**2xl and wider (Record column visible).** Column widens from `w-40` to `w-48` (192 px). Two lines in the cell:

```
O-7731 Fibre upgrade     <- link, label-12, underlined, truncated
Order                    <- kind, label-12, secondary
```

The link is `flex min-h-6 items-center`. Two lines total: 24 + 14 = 38 px, fits in 56.

**Below 2xl (the common case).** The record goes on the second line of the Name cell, last, so truncation eats it before it eats the "to check" count:

```
Quote_Fibre_upgrade_v3.pdf
Contract · 2 to check · Order O-7731 Fibre upgrade      <- last part is the link
```

- The second line becomes `min-h-6` and `flex items-center` so the link is 24 px tall (16 + 24 = 40 px in a 56 px row).
- The record part is hidden with `2xl:hidden`; the column is hidden below 2xl. Exactly one record link is in the accessibility tree at any width (display none removes the other). The Right-arrow handler must pick the link that is visible.
- No record, or a record the person can't open: show nothing on this line. (The wide column keeps its current wording, below.)
- Link text on this line: `{kind} {name}` without the dot ("Order O-7731 Fibre upgrade"), because the dot is the separator between the other parts of the line.

### Link style in the table (differs from the panel on purpose)

Do not use `text-link`. It fails on `item-hover` (see facts). Use `underline underline-offset-2` and inherit the colour the cell already uses: `text-text-secondary`, becoming `group-hover:text-text-main`, as the other secondary text in the row. The underline is what marks it as a link. On the selected row (`bg-item-selected`) the text keeps whatever colour the row has now; check it as part of the hover-contrast test (see criteria). Hover on the link itself adds `hover:text-text-main`.

Focus ring: `focus-ring` as everywhere. The ring is drawn with a 2 px offset; the row clips nothing (`overflow-auto` is on the scroller, rows are `absolute`). Check the ring is not cut at the right edge.

### Copy and states

| State | Wide column | Narrow layout | Screen reader |
|---|---|---|---|
| Record visible | link "O-7731 Fibre upgrade", second line "Order" | link "Order O-7731 Fibre upgrade" at the end of line 2 | link name is the visible text |
| Record exists but not readable (`entity_id` set, `entity_name` null) | "Record you can't open", plain text, no link (existing) | nothing | text read as part of the row |
| No record (`entity_id` null) | "—" (existing) | nothing | existing behaviour |
| Long name | one line, ellipsis | one line, ellipsis. "to check" stays visible because it comes first. | full name in the link text |
| Loading rows | skeleton (existing) | | |
| Empty / error | existing "No documents match" and "The results couldn't load just now." Unchanged. | | |
| Viewer | link shown. Reading a record is allowed. | | |
| Shared-only | A shared-only document has no record in the table (`entity_name` null). Nothing new. | | |

The `kind` for the table comes from `entity_type` on the row via the shared helper (P1).

### Target sizes

Link: 24 px tall minimum (2.5.8). The row is 56 px. The checkbox stays as it is. Do not ask for 44 px: that is AAA and would cost a row of density.

### Light and dark

Row text colours already work in both themes through the secondary-to-main hover swap. The link adds only an underline, so no new colour pair is introduced. Verify in dark: `text-secondary` (#8b8b8b) on `item-hover` (#4e4e4e) is under 4.5:1 today, which is why the row swaps to `text-main` on hover. Keep that swap on the link and on its second line.

### Acceptance criteria

1. At 1600 px wide the Record column shows a link and the kind on a second line. At 1366 px wide the record shows at the end of line 2 of the Name cell. At each width exactly one record link exists in the accessibility tree per row.
2. Clicking the link opens `/records/{id}` and does not open the panel, does not change `doc` in the URL and does not tick the row.
3. Ctrl-click or Cmd-click opens a new tab and the current page is unchanged.
4. With a row focused: Enter opens the panel; Space ticks; Right arrow focuses the link; Enter on the link navigates and does not open the panel; Left arrow and Escape return focus to the row; Down arrow from the link moves to the next row.
5. Tab order: one tab stop for the whole grid (unchanged). The link and the checkbox are `tabindex="-1"`.
6. A row with `entity_id` set and `entity_name` null never renders a link, and the id is not present anywhere in its markup.
7. A row with a 150-character record name does not change the row height and does not hide "N to check".
8. Axe scan with a row hovered and with a row selected, light and dark. Add the link to `src/test/hover-contrast.test.ts` so the hover colours are guarded.
9. Zoom 400% on the results page: no two-direction scroll caused by the link.

---

## Change 3. "Add documents" in the Documents page header

### Challenge to the proposed flow

The brief says browsers block opening a file picker after navigation. The detail matters, because it decides what we can promise. This app navigates inside one page (TanStack Router), so the click's permission to open a picker does not vanish at once. It lasts a few seconds in Chromium, less in Safari, and the record route has a loader that waits for data before it renders. So: it might work on a fast network, and fail on a slow one. A picker that sometimes opens by itself, sometimes not, is worse than one that never does. Decision stands: do not auto-open the picker.

Flows compared:

| | A. Choose record, then go to the record page (proposed) | B. Choose record and files in the dialog, hand files over in memory |
|---|---|---|
| Clicks to a confirmed upload | Add documents, record, Add documents on the record page, files, confirm | Add documents, record, Choose files, confirm |
| State to carry | Only the URL (`?add=1`) | `File` objects in memory across a route change |
| Reload or Back | Safe | Files are lost. Needs its own message. |
| If the record turns out to be unavailable | The page says so, nothing lost | The files are already chosen and are dropped. Needs a message. |
| Can be linked ("add to this record") | Yes | No |
| New code | Small | Hand-over store, cleanup, tests, a second dialog step |

Recommendation: ship A. It has no hidden state, and `?add=1` is a useful link on its own (an email to a colleague, a bookmark). B saves one click. Take it only if usability tests show people stall on the record page. Keep the dialog's result list the same so B can be added later without redoing it. This is a judgement call, not a measurement: nobody has tested either.

One improvement to A over the brief: remove `add` from the URL once it has been used (replace navigation), so Back and Reload do not move focus again or show the hint a second time.

### Part 3a. The header action

**Placement.** `PageHeader` on the Documents page gets `actions`: one primary Button, `Add documents`, with the `Upload` icon and the same markup as the record page button. Same label on both pages is intended: it is the same job. The record page button opens the file picker, this one opens the record chooser, and the dialog says why.

The page has one primary action. Keep "Clear all", "Try again" and the rest as default or ghost buttons.

**States.**

| State | What shows |
|---|---|
| Contributor and up (`can(role, "edit")`) | Primary button. Click opens the dialog. |
| Viewer | Same button with `unavailable` (so `aria-disabled`, still focusable), and the reason as visible text to its left in the actions slot: "Viewers can open documents here but can't add them." Linked with `aria-describedby`. Click does nothing (the Button already swallows it). |
| Role not loaded | The page loader already waits for `meQuery`. Not a state here. |
| Narrow width | Actions wrap under the title. Reason text sits above the button, right-aligned. |

Reason text is `type-label-12 text-text-secondary` (on `layer-content`, same as the record page reason).

**Keyboard and focus.**

- Tab order on the page: nav, header button, search field, saved views, results. The button comes before the search field because it is in the header.
- Enter or Space opens the dialog. Closing the dialog returns focus to this button (the Dialog already remembers the opener).

**Screen reader.** Name "Add documents". Viewer: name plus description (the reason) and it is announced as dimmed or unavailable. The icon is `aria-hidden`.

**Target size.** `Button` is 32 px tall (above 24 px).

**Light and dark.** Existing primary and unavailable button styles. No new colours.

### Part 3b. The dialog "Choose a record"

Component: `ChooseRecordDialog` in `src/components/upload/` (new file). Local open state in `DocumentsPage`. Uses `Dialog`, `TextField`, router `Link`. Search uses `useRecordMatches(q, enabled)` (it already calls `api.findRecord`). Debounce 300 ms, the same as `SearchBox`.

**Layout.**

```
Choose a record                                          [x]
Documents belong to a record, such as an order, quote or account.
Pick the record these files go with.

Find a record
[ Search icon | ____________________________ ]
Type at least 2 characters of the record number, or the start of its name.

Recently changed                       (only when the field is empty)
  Order    O-7731 Fibre upgrade
  Quote    Q-2210 Rooftop sites
  ...
```

When there is a query, the list below the field is the search result, not "Recently changed".

**Copy.**

| Where | Text |
|---|---|
| Title | Choose a record |
| Description | Documents belong to a record, such as an order, quote or account. Pick the record these files go with. |
| Field label | Find a record |
| Field helper | Type at least 2 characters of the record number, or the start of its name. |
| Section heading, empty field | Recently changed |
| Status, 1 character typed | Keep typing. 2 characters are enough to search. |
| Status, searching | Searching… |
| Status, results | 3 records found (or "1 record found") |
| Status, 5 results | Showing the first 5. Type more to narrow it down. |
| No results | No record starts with "{query}". Check the number, or type the start of the name. Records you don't have access to aren't listed. |
| Error | We couldn't search just now. (with a "Try again" button) |
| Recents empty or failed | Nothing shown. The field and helper are enough. Recents are a shortcut, so their failure is not announced. |
| Footer actions | None. The dialog has Close (X) and Escape. No Cancel button: nothing is pending to cancel. |

Use the typographic quotes around `{query}` in the real string. Do not escape or trim the user's text inside quotes beyond the 64-character field limit; show at most 40 characters of it and add "…" after that.

**Results.**

- Each result is a router `Link` to `/records/$entityId` with `search={{ add: 1 }}`, rendered as a list item (`ul` with an accessible name "Matching records", same wording as the list under the search box).
- Item content: kind (`label-12`, secondary) then name (`label-14`). Format on one line: "Order · O-7731 Fibre upgrade" in text, with the kind visually lighter. The link name is that full text.
- `min-h-10`, full width, `hover:bg-item-hover`, `focus-ring`. The kind swaps to `text-main` on hover (same reason as the table: secondary text on hover fails 4.5:1 in dark).
- Long name: one line, ellipsis, full text in the accessible name. The row never wraps, so 5 rows stay about 200 px tall.
- Order: as returned. Developer: ask for a stable order in `findRecord` (`order("display_name")`) in the same change, so the same query always lists the same 5. This is a one-line server change.
- Recents: derived from the existing `previewQuery({}, 10)` (documents sorted by last change, already RLS-filtered, includes `entity_id`, `entity_name`, `entity_type`). Take distinct records where `entity_name` is not null, first 5. Enabled only while the dialog is open and the field is empty. Label them "Recently changed", not "Your recent": the list is by changes anyone made, not by this person's visits. A browser-stored "my last records" list is deliberately not proposed: it would keep record names on the device after access is removed.
- Choosing a result navigates. The dialog closes because the page unmounts. Back returns to Documents with the dialog closed and the URL unchanged.

**States.**

| State | Behaviour |
|---|---|
| Open, nothing typed | Helper text, recents if they loaded |
| Typing, under 2 characters | Status "Keep typing…". No request. Not styled as an error. |
| Loading | Status "Searching…". Previous results stay until new ones arrive (no flicker). |
| Results | List and count status |
| No results | Message above. List hidden. |
| Error | Message and "Try again". Field keeps its text. |
| No access to a record | It is not listed (RLS). The no-results sentence says so. |
| Viewer | The dialog cannot open (button is unavailable). |
| Long query | Field stops at 64 characters (`maxLength={64}`, matches the server limit). |
| Slow network | Status stays "Searching…". No timeout message in v1. |

**Keyboard and focus order.**

1. Dialog opens. Focus goes to the search field (needs P3). Today it would land on Close.
2. Type. Results update after 300 ms.
3. Down arrow in the field, or Enter in the field, moves focus to the first result. It does not navigate by itself, so a half-typed query cannot open the wrong record.
4. Up and Down move between results. Up on the first result returns to the field.
5. Enter on a result navigates.
6. Tab order if arrows are not used: field, results (each a stop), Close.
7. Escape closes. Focus returns to the header button.

**Screen reader.**

- Dialog name: "Choose a record". Description is the text under the title.
- Field name "Find a record", described by the helper.
- The status line is `role="status"` with `aria-live="polite"`, as the result count on the Documents page does. It is a separate element from the helper and is always in the DOM so the first change is announced.
- Result link names: "Order · O-7731 Fibre upgrade".
- Do not use `role="combobox"` or `listbox`. A field with a list of links is simpler and has fewer ways to fail. The arrow keys are a convenience on top, not what makes it work.

**Target sizes.** Field 32 px (existing). Results 40 px tall. Close button 24 px (existing Dialog).

**Light and dark.** Existing Dialog, TextField, hover tokens. No new colours. Check the dialog's `border-border-item` against `layer-content` in dark, as it is the only edge since the Dialog has no backdrop (existing behaviour, not changed here).

### Part 3c. Arrival on the record page

When the route has `add=1`:

1. After the page renders, focus moves to the Add documents button (`AddDocuments` accepts `focusAddOnMount`; it forwards a ref to the button).
2. A hint shows under the button, in the same place as the viewer reason: "Adding to {record name}. Choose Add documents, or drop files into the list." `label-12`, secondary text. The button gets `aria-describedby` pointing to it, so a screen reader hears the record when focus lands. This matters: focus lands on a button and the page title is not read.
3. Then the page replaces the URL without `add` (keeping `doc` if present). The hint stays on screen for this visit, held in component state. It goes away when the person opens the picker, drops files, or leaves the page. No timer.
4. If the person is a viewer, the existing reason shows instead of the hint. Focus still goes to the (unavailable) button, whose description is the reason.
5. If the record is not available (existing empty state "This record isn't available to you"), there is no button. Nothing to focus, no hint. The existing "Back to documents" link stays.
6. Long record name in the hint wraps. It is not truncated, because the point of the hint is to confirm where the files go.

Acceptance for 3c:

- Landing on `/records/X?add=1` as a contributor: the button is focused, hint visible, URL becomes `/records/X`.
- Reload at that point: no focus jump, no hint.
- Same as a viewer: reason visible, no hint, no dialog.
- `?add=banana` loads the page normally and ignores the value.
- Screen reader on landing hears "Add documents, button, Adding to O-7731 Fibre upgrade. Choose Add documents, or drop files into the list."

### Acceptance criteria for 3a and 3b

1. A contributor sees one primary "Add documents" button in the Documents header on every state of the page (start lists, results, empty results, results error).
2. A viewer sees the button with `aria-disabled="true"`, focusable, with the reason visible. Clicking it does not open the dialog.
3. Click opens the dialog. Focus is in the search field. Escape closes it and focus is back on the header button.
4. Typing 1 character makes no request. Typing 2 or more makes one request after 300 ms, to `findRecord`.
5. With 5 results the status says so. With 0 results the no-results text shows with the typed text in quotes.
6. A forced server error shows the error text and "Try again", and keeps the typed text.
7. Choosing a result goes to `/records/{id}?add=1` and then to 3c behaviour.
8. Down arrow or Enter in the field focuses the first result and does not navigate.
9. At 400% zoom the dialog scrolls and no control is unreachable. At 320 px wide there is no sideways scroll.
10. Axe scan with the dialog open, empty and with results, light and dark: no violations.
11. Recents never contain a record whose `entity_name` is null.

---

## Cross-cutting

**Copy rules applied.** Plain words, says what happened and what to do, sentence case, one term per concept: "record" everywhere (never "entity", "object", "folder"), "documents" (never "files" for stored items; "files" only for the things a person picks from their computer, as the existing upload dialog does).

**Not in the three changes.**
- Start-list rows still show the record name as plain text.
- The grid has no column headers in its accessibility tree (the header row is `role="presentation"`). Pre-existing. Worth its own ticket.
- Dropping files on the Documents page is stopped by the global drop guard and nothing tells the person why. A short note there would help. Not part of this work.

**Test plan summary.**
- Unit: `addDocumentsState` (viewer false with reason, contributor and up true); kind label helper for all 7 types and an unknown code.
- Component: panel states (null id, not found, found, error); results table key handling (Enter on link, Right and Left arrows, Space, click and Ctrl-click); dialog states; record page focus and URL replace.
- Browser: axe on panel, hovered and selected row, dialog, in light and dark; keyboard-only walk of all three routes; 400% zoom.
- Manual with a screen reader before release (accessibility.md says axe finds only about a third of issues): panel link, the Right-arrow move in the grid, dialog status announcements, arrival hint on the record page. I have not done this and cannot.

**Order of work.** P1 to P5, then change 1 (smallest, covers keyboard access for change 2), then change 2, then change 3. Changes 1 and 2 can ship without 3.

## Open questions (they change the work)

1. What do real record ids look like? If they contain `_`, `%`, `,` or parentheses, P4 needs `getRecord(id)`. Affects change 1.
2. Is `DocumentPanel` rendered anywhere besides `/documents`, `/records/$entityId` and `/shared/$docId`? Affects where `showRecord` must be passed. (I could not search.)
3. Does `DocumentDetails` hold unsaved edits? A panel link that leaves the page would drop them. If it does, the link needs a leave guard or the details form needs to save drafts. I did not read that component.
4. Is the Right-arrow move into a row's link worth its cost? The spec treats it as optional because change 1 already gives a keyboard route. Product decision.
5. Do you want flow B tested against flow A before building A? It costs a prototype, and I have no data for either.
