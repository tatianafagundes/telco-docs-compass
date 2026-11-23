# Admin

- **URL:** `/admin (tabs: Document types, Policies, Holds and retention, Connected systems, Tenants)`
- **Who:** tenant_admin and master_admin (others: "Admin is for administrators")

## Purpose
Configuration for the organisation. Its areas are children of Admin in the main navigation (an EDS navigation tree, list labelled "Admin areas"): the Admin label opens the first area, the chevron shows or hides the areas, and inside Admin the current area is highlighted. The page title is the area name.

## Layout and actions
See the per-tab screens.

## Accessibility
- Every action is reachable by keyboard. Unavailable actions use `aria-disabled` and show the reason as visible text.
- Dialogs return focus to the control that opened them. Targets are at least 24 px.
- Status is never shown by colour alone.

![Admin](img/admin-1280.png)

![Admin](img/admin-792.png)
