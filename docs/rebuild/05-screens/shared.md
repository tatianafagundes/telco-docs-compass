# Shared with me

- **URL:** `/shared and /shared/{docId}`
- **Who:** any signed-in person

## Purpose
Documents shared directly with the person, even without access to the parent record.

## Layout and actions
List with paging (Previous/Next). Opening a document shows the document panel without record details. Record links appear only if the person can read that record (BR-093). Actions are capped by the share level (BR-004). "Back to Shared with me".

## States
Empty: "Nothing shared yet". Error: "We couldn't load your shared documents just now." + Try again. A removed share makes the link show not available at once (BR-094).

## Accessibility
- Every action is reachable by keyboard. Unavailable actions use `aria-disabled` and show the reason as visible text.
- Dialogs return focus to the control that opened them. Targets are at least 24 px.
- Status is never shown by colour alone.

![Shared with me](img/shared-1280.png)

![Shared with me](img/shared-792.png)
