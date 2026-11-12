# 13 — Angular frontend

## Design tokens
- **Source:** `reference/design/tokens.css` (all hex values, light and dark themes) and `reference/design/styles.css` (utility mapping). Port them as CSS custom properties in `styles/tokens.css`. Components use only tokens, never raw colours.
- **Theme:** dark mode switches the token set, and the toggle sits in the top bar.
- **Tokens,** grouped by family:
  - **Text:** main, secondary, disabled, link, contrast, on-primary
  - **Layers:** application, content, system
  - **Fills:** buttons, inputs, items and cells, each with idle, hover, press and selected states; tooltip
  - **Borders:** buttons, cells, inputs (idle, hover, error), items (idle, hover, selected, subtle), focus and focus-dark
  - **Status:** cleared, minor, major, critical, indeterminate, warning, purple
  - **Typography:** title 18/16/14, label 14/12, paragraph 14, family `--font-erad`
  - **Spacing:** none, xxs through xxxl, overlap
  - **Radius:** none, hairline, badge, control, control-focus, pill
  - **Shadow:** elevation 1–3
  - **Sizes:** control-height, row-height, widths for cards, dialogs and the side panel
  - **AI gradient:** start, end

## Component library (port of `src/components/erad/`)
| Component | Notes |
|---|---|
| AppShell | Top bar (product, prototype badge, tenant name, theme toggle, avatar) and side nav filtered by role. Includes a global file-drop guard so dropped files never open in the browser. |
| Button | Variants: default, primary, ghost/link. Sizes: default, small. **Unavailable means `aria-disabled="true"` plus visible reason text, never native `disabled`.** |
| Banner | Info, warning and error messages, with an optional action |
| Breadcrumb, PageHeader | Record context: type, id, name, source-system status |
| Card, Divider | |
| Checkbox, RadioGroup, Select, TextField | Label, help text and error, all linked by `aria-describedby`. The reference shows help and error text only on TextField; the rebuild renders the same Label 12 line under Select, Checkbox and RadioGroup and sets `aria-invalid` on the trigger or group. Error text uses a text token that reaches 4.5:1 in both themes; `border-input-error` is a border token and is not used for text (the reference does, 3.31:1 in dark). |
| DataTable | Plain `<table>` with sr-only caption, `scope="col"`, `aria-sort`, a selection column and row actions visible in the idle state; a row that opens something does so through a button in its first cell, never a click on the `tr` (the reference's rows are click-only). Used by admin and holds tables. |
| ResultsTable (Documents) | Virtualised grid with one Tab stop, keyboard row navigation, `aria-rowcount`/`aria-rowindex`, real column headers, the open-row state (`aria-current`) and `fill-cell-selected` for the open row (see 05-screens/documents.md). |
| Dialog | Remembers the focused element when it opens and returns focus there on close. Esc closes it. Focus is trapped while open. |
| SidePanel | Document panel; the list keeps its scroll position. Opening it does not move focus; closing it (collapse button, Esc, or the row toggling it off) returns focus to the row or button that opened it. Below 1280 px it overlays the content. |
| EmptyState | Encouraging title, text and a call to action |
| Tag, Pill | Tones: cleared, minor, major, critical, indeterminate, warning, purple. Used for status and confidence, always with the word, the tone colour and the 16 px tone icon (see 05-screens/README.md for the small-tag decision). Status colours are used on tags, borders and icons only; running text is `text-main`, `text-secondary` or `text-link` (the reference paints three lines in status colours, below 4.5:1). |
| Tabs (TextTabs, NavTabs) | Roving tabindex; the indicator shows the active tab |
| Tooltip | Never the only way to get information |
| Spinner, Skeleton, SkeletonRow, ProgressBar, Avatar | Loading states. ProgressBar fill contrasts at least 3:1 with its track in both themes (the reference's dark pair is 1.85:1) and is paired with a visible count. Loading lists expose a `role="status"` text. |

Feature components to port:
- **Access:** manage-access dialog, why-can-i-see.
- **Admin:** connected systems, system limits dialog, policy cards, spec panel and table, source tag, stat counts, reset test data.
- **Documents:** document panel, actions bar, menu, details, approved summary.
- **Holds:** holds, retention and deletion tabs.
- **Review:** document page with markers, field row, review footer, journey.
- **Search:** facet panel, results table, saved views, bulk bar, start lists, URL state.
- **Upload:** drop zone and file rows with progress.

## Routing and guards
| Route | Guard |
|---|---|
| /auth | Keycloak login redirect |
| /documents | authenticated |
| /records/:entityId | authenticated; "not available" view on 404 or denied |
| /records/:entityId/review/:docId | authenticated |
| /shared, /shared/:docId | authenticated |
| /holds | authenticated (content depends on role) |
| /admin/(types, policies, holds, systems, tenants, tenants/:tenantId) | role tenant_admin or master_admin; tenants only for master |

Guards only hide navigation. **The server decides access.** A denied page shows the unavailable message, never data.

## State and data
- **Server state:** services with `HttpClient` plus signals (or TanStack Query for Angular, to keep the cache-key conventions). Keys: `['document', id]`, `['documents', filters]`. Invalidate parents after a mutation.
- **Auth:** a `keycloak-angular` interceptor adds the bearer token. A 401 triggers a silent refresh, then login.
- **Errors:** the API returns `SeamError`. A `handleError` service maps `customerFacing.key` to copy, and raw messages are never shown.
- **Search:** filter state lives in the URL query params, normalised as in BR-101.
- **Review:** keyboard shortcuts (J/K, arrows, C, E, N) are active only while the details list has focus (`keydown` on the list, as in the reference, not a document-level listener), so no single-key shortcut fires elsewhere on the page (WCAG 2.1.4). Esc returns to the document except while a value is being corrected or a dialog, menu or select is open.
- **Auth:** if re-login is needed mid-task, the app returns to the same URL and keeps unsent field values (correction, hold reason, note) until the request is sent.

## i18n readiness
The current app is English-only. Use Angular i18n or Transloco with keys from day one, and keep exact English strings from `03-business-rules.md` and `05-screens/` as the en source.

## Accessibility checklist (WCAG 2.2 AA)
- Keyboard: every action works without a pointer, and focus is always visible (`--focus-ring`).
- Focus returns after dialogs and panels close: to the control that opened a dialog, to the row or button that opened a side panel, and from Check details back to the "Check details" link that opened it. Focus never lands on `body`. Tab panels are not Tab stops; menu and select options show focus with the ring or with `fill-item-selected` + `text-contrast`, never with `fill-item-hover` alone.
- Unavailable actions stay focusable and show their reason.
- Every pointer target is at least 24×24 px of hit area (a 16 px checkbox or radio without a label gets 4 px of padding on each side; icon-only buttons are 32 px), and contrast is AA in both themes. Token pairs that fail in the reference and must not be reused: `text-main` on `fill-item-selected` (3.45:1 light), `text-secondary` on `fill-item-hover` (3.94:1 light, 2.44:1 dark), `border-input-error` as text in dark (3.31:1), `status-cleared`/`status-critical`/`status-major` as running text, `text-on-primary` on `border-focus` (3.77:1 light, 2.76:1 dark). The dark focus ring is `--border-focus-dark` `#b98ad0` (5.6:1), not the DESIGN table's `#8e45b0` (2.7:1); see `docs/decisions/01-foundation-gaps.md`.
- Layout works at 200% zoom, at 792 px width, and on phones (review uses tabs below 900 px).
- Status and confidence always carry words, not just colour.
- Live regions announce: the result count, "Loading more…", bulk progress and summary, the upload final summary, review progress "N of M checked", the outcome line, "Why can I see this?", sign-in errors and saved changes. Toasts (`role="status"`, polite) confirm actions but are never the only place for an action or an error: Undo after delete is also offered in a persistent place for the same role, and errors raised inside an open dialog appear inside that dialog.
- Icons never carry `aria-label` on their own: a meaningful icon is `role="img"` with a name or is paired with text; `aria-label` is never put on `span`, `code` or other generic elements. Repeated actions name their object ("Open <name>", "Select <name>", "Change <field>").
- `prefers-reduced-motion: reduce` collapses every transition and animation to an instant change; `color-scheme: dark` is set under the dark theme.
- Run axe-core in the Playwright suite on every screen, in both themes.
