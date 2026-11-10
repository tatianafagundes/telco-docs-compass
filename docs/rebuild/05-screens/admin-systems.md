# Connected systems

- **URL:** `/admin/systems`
- **Who:** tenant_admin

## Purpose
Systems that use the TMF667 API (see 07).

## Layout and actions
Add system (name, kind, scopes) → key shown once with a copy button. Rotate, revoke, set per-minute read/change limits (BR-110) with bounds validation. Shows key prefix, expiry, last use.

## States
Empty: encouraging call to action to connect the first system.

## Accessibility
- Every action is reachable by keyboard. Unavailable actions use `aria-disabled` and show the reason as visible text.
- Dialogs return focus to the control that opened them. Targets are at least 24 px.
- Status is never shown by colour alone.

![Connected systems](img/admin-systems-1280.png)

![Connected systems](img/admin-systems-792.png)
