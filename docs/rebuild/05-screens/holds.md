# Holds and retention

- **URL:** `/holds`
- **Who:** managers and admins (others: "Holds are managed by managers")

## Purpose
Documents under legal hold and retention overview for the tenant.

## Layout and actions
List of holds with reason, reference and who set them. Release needs manage. Retention overview shows effective retention, raised by the group floor (BR-055).

## States
Empty and error states per list.

## Accessibility
- Every action is reachable by keyboard. Unavailable actions use `aria-disabled` and show the reason as visible text.
- Dialogs return focus to the control that opened them. Targets are at least 24 px.
- Status is never shown by colour alone.

![Holds and retention](img/holds-1280.png)

![Holds and retention](img/holds-792.png)
