# 01 – Foundation gaps (components not defined in DESIGN.md)

Built from tokens only. DESIGN.md is unchanged.

| Component | Why |
|---|---|
| Text tab bar (32px, Label 14, 2px `border-item-selected`) | The ERAD tab-nav item (80x58 with caption) cannot hold "Documents 10 · 2 need attention". |
| Destructive button (primary shape, `status-critical` fill, `text-on-primary`) | Delete needs a distinct, unmistakable action. |
| Progress bar (4px, `fill-item-selected` on `border-item-subtle`) | Upload progress. |
| Inline banner (Card with a status tag at the left) | Hold, quarantine and failure notices inside a page. |
| Skeleton row | Loading state for 48px table rows. |
| Avatar (24px circle, initials) | User menu and activity rows. |
| `border-focus-dark` token | `#8e45b0` on `#242424` is about 2.6:1; the lighter purple reaches 3:1 (WCAG 1.4.11). Recorded as a divergence. |
| Scoped `[data-theme]` token copies | Lets /design show light and dark side by side. |

Unavailable controls use `aria-disabled` with a visible reason, never native `disabled`, so the reason stays reachable by keyboard.
