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
| Checkbox, RadioGroup, Select, TextField | Label, help text and error, all linked by `aria-describedby` |
| DataTable | Virtualised rows, keyboard row navigation, a selection column, and a selected-row highlight |
| Dialog | Remembers the focused element when it opens and returns focus there on close. Esc closes it. Focus is trapped while open. |
| SidePanel | Document panel; the list keeps its scroll position |
| EmptyState | Encouraging title, text and a call to action |
| Tag, Pill | Tones: cleared, minor, major, critical, indeterminate, warning, purple. Used for status and confidence, always with words as well as colour. |
| Tabs (TextTabs, NavTabs) | Roving tabindex; the indicator shows the active tab |
| Tooltip | Never the only way to get information |
| Spinner, Skeleton, SkeletonRow, ProgressBar, Avatar | Loading states |

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
- **Review:** keyboard shortcuts (J/K, arrows, C, E, N) use a host listener and are ignored while typing in inputs.

## i18n readiness
The current app is English-only. Use Angular i18n or Transloco with keys from day one, and keep exact English strings from `03-business-rules.md` and `05-screens/` as the en source.

## Accessibility checklist (WCAG 2.2 AA)
- Keyboard: every action works without a pointer, and focus is always visible (`--focus-ring`).
- Focus returns after dialogs and panels close.
- Unavailable actions stay focusable and show their reason.
- Targets are at least 24×24 px, and contrast is AA in both themes.
- Layout works at 200% zoom, at 792 px width, and on phones (review uses tabs below 900 px).
- Status and confidence always carry words, not just colour.
- Live regions announce upload progress, bulk results and saved changes.
- Run axe-core in the Playwright suite on every screen, in both themes.
