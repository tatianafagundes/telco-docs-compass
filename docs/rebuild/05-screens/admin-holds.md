# Admin: holds and deletion

- **URL:** `/admin/holds`
- **Who:** admins

## Purpose
Holds, deletion history, verify holds, permanent deletion (BR-052–053).

## Layout and actions
Delete permanently is shown with its reason when unavailable.

## Accessibility
- Every action is reachable by keyboard. Unavailable actions use `aria-disabled` and show the reason as visible text.
- Dialogs return focus to the control that opened them. Targets are at least 24 px.
- Status is never shown by colour alone.

![Admin: holds and deletion](img/admin-holds-1280.png)

![Admin: holds and deletion](img/admin-holds-792.png)
