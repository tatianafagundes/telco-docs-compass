# 05 — Screens

Screenshots were taken from the current app in light theme at 1280 px and 792 px (`img/`). The copy shown is exact. Every page also has: the app shell (top bar with tenant name, theme toggle and avatar; side navigation for Documents, Shared with me, Holds and retention, Admin, filtered by role), a workspace loading state ("Loading your workspace"), and "No access assigned. Ask an administrator." when a person has no role.

| Screen | URL |
|---|---|
| [Sign in](sign-in.md) | `/auth` |
| [Documents (search)](documents.md) | `/documents` |
| [Record](record.md) | `/records/{entityId}` |
| [Check details](review.md) | `/records/{entityId}/review/{docId}` |
| [Shared with me](shared.md) | `/shared and /shared/{docId}` |
| [Holds and retention](holds.md) | `/holds` |
| [Admin](admin.md) | `/admin (tabs: Document types, Policies, Holds and retention, Connected systems, Tenants)` |
| [Document types](admin-types.md) | `/admin/types` |
| [Policies](admin-policies.md) | `/admin/policies` |
| [Admin: holds and deletion](admin-holds.md) | `/admin/holds` |
| [Connected systems](admin-systems.md) | `/admin/systems` |
| [Tenants (group)](admin-tenants.md) | `/admin/tenants and /admin/tenants/{tenantId}` |
| [Design review (developer only)](design.md) | `/design` |

Note: the screenshots include leftover automated-test items ("TMF test …"). Reset test data removes them.
