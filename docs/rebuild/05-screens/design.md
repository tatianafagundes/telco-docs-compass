# Design review (developer only)

- **URL:** `/design`
- **Who:** developers

## Purpose
Living inventory of ERAD components and tokens in both themes. Not part of the product; in the rebuild use Storybook.

## Accessibility
- Every action is reachable by keyboard. Unavailable actions use `aria-disabled` and show the reason as visible text.
- Dialogs return focus to the control that opened them. Targets are at least 24 px.
- Status is never shown by colour alone.
