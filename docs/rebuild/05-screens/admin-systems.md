# Connected systems

- **URL:** `/admin/systems`
- **Who:** tenant_admin

## Purpose
Systems that use the TMF667 API (see 07).

## Layout and actions
Intro: "Let Order care, Ticket management, CRM or CPQ work with your documents through the TM Forum Document Management API (TMF667). Each system gets its own key, sees only this organisation, and every action it takes appears in the document's activity." Button **Connect a system** (name, kind, scopes) → key shown once with a copy button. Rotate, revoke, set per-minute read/change limits (BR-110) with bounds validation. Each card shows: name, kind (e.g. "Order care (TMF622)"), a Disconnected tag when revoked, "Key starting erad_… · last used <time>", "Allowance: N reads and M changes per minute", "Last slowed down for sending too many requests: <time>", and "Can: …" scopes written in plain words.

## States
Empty: encouraging call to action to connect the first system.

## Accessibility
- Every action is reachable by keyboard. Unavailable actions use `aria-disabled` and show the reason as visible text.
- Dialogs return focus to the control that opened them. Targets are at least 24 px.
- Status is never shown by colour alone.

![Connected systems](img/admin-systems-1280.png)

![Connected systems](img/admin-systems-792.png)
