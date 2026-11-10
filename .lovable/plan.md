# Redesign the design review page

## What is wrong today (review from several angles)

- **Apple HIG / clarity:** everything is shown at once, twice (light and dark side by side), with no hierarchy. Nothing says what a component is for or when to use it.
- **Product designer:** sections mix unrelated things ("Card, banner, panel", "Feedback" holding a divider and an avatar). Labels like "Default", "Unchecked" describe props, not decisions.
- **Engineer:** no way to find one component quickly, no names matching the code, no usage notes.
- **Accessibility reviewer:** states (focus, unavailable-with-reason, error) are buried; two identical boards double the tab stops.
- **At your viewport (792px):** the two-theme grid collapses into one very long scroll.

## Market references applied

Apple HIG, Shopify Polaris, IBM Carbon, GitHub Primer, Atlassian: each uses a **left index + one component per view**, a short "when to use / when not to" note, a live example, a states row, and a **single theme toggle** instead of duplicating everything.

## New structure

```text
+--------------+------------------------------------------+
| Search       |  Buttons                    [Light|Dark] |
|              |  One line: what it's for                 |
| Foundations  |  -------------------------------------- |
|  Colour      |  Example (one realistic telecom scene)   |
|  Type        |  Variants  (labelled by intent)          |
| Actions      |  States    (rest, focus, unavailable+why)|
|  Buttons     |  Do / Don't  (two short cards)           |
| Inputs ...   |                                          |
| Status ...   |                                          |
| Layout ...   |                                          |
| Feedback ... |                                          |
+--------------+------------------------------------------+
```

- **Groups:** Foundations (colour, type, spacing), Actions (button, tooltip), Inputs (text field, select, checkbox, radio), Status (tag, pill, banner), Navigation (tabs, breadcrumb), Data (table, skeleton row), Layout (card, side panel, divider), Feedback (dialog, toast, progress, spinner, empty state, avatar).
- **One theme toggle** in the header, remembered for the session; replaces the side-by-side boards.
- **Overview page** first: short purpose, principles (calm, explicit reasons, customer words), and cards linking to each group.
- **Each component view:** purpose line, one realistic example in context (e.g. contract record), variants named by intent ("Main action", "Risky action", "AI suggestion"), states row, do/don't.
- **Small screens:** index becomes a select at the top.
- Stays developer-only; English only; no new libraries.

## Technical details

- Split `src/routes/design.tsx` into a layout route with index (`design.tsx` rendering `<Outlet />`), `design.index.tsx` (overview) and `design.$component.tsx` driven by a typed registry in `src/components/design-review/registry.tsx` (id, group, title, purpose, example, states, do/don't).
- Shared pieces under `src/components/design-review/`: `review-nav.tsx`, `spec-section.tsx`, `do-dont.tsx`, `theme-toggle.tsx` (sets `data-theme` on the preview frame only).
- Foundations views read token names from `src/styles/tokens.css` utilities only; no hex in components.
- Unknown component id → not-found view with link back to overview.
- Verify with Playwright at 1280 and 792 widths, both themes.
