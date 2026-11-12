# 05 — Screens

Screenshots were taken from the current app in light theme at 1280 px and 792 px (`img/`). The copy shown is exact. Every page also has: the app shell (top bar with tenant name, theme toggle and avatar; side navigation for Documents, Shared with me, Holds and retention, Admin, filtered by role), a workspace loading state ("Loading your workspace"), and "No access assigned. Ask an administrator." when a person has no role.

## Rules common to every screen (review 2026-11-12)
- **Status and processing labels** (`src/lib/document-labels.ts`, exact English): status draft "Draft", in_review "In review", approved "Approved", effective "Effective", superseded "Superseded", expired "Expired", archived "Archived". Processing, shown next to the status whenever it is not ready: uploading "Uploading", scanning "Checking for threats", reading "Reading details", ready "Ready", failed "Couldn't read", quarantined "Blocked for safety". Status tones: draft/superseded/archived indeterminate, in_review warning, approved/effective cleared, expired minor; processing tones: uploading/scanning indeterminate, reading purple, ready cleared, failed major, quarantined critical.
- **Status tags** carry the tone colour, the word and the 16 px tone icon. The prototype's 16 px "small" tag drops the icon even when one is passed (`src/components/erad/tag.tsx:62`) and is the variant used for status in the results, record, shared, panel, systems, holds and upload lists; whether status moves to the 24 px tag or the small tag gains an icon is the owner's decision (see `../../review/2026-11-multi-perspective.md`, perspective 5).
- **Narrow widths** (kit `AGENTS.md` and `DESIGN.md` "Divergências registradas"): below 1280 CSS px the navigation collapses to 80 px and every side panel overlays the content instead of squeezing it (the prototype's `SidePanel` has an `overlay` prop that no screen passes). The Documents filter panel must stay reachable below 768 px (the prototype hides it, `documents.tsx:140`); how it is reached is the owner's decision. There is no phone layout; the "on phones" wording in `13` and `14` conflicts with the kit and awaits the owner's decision.
- **Focus** returns to the control that opened a dialog, and to the row or button that opened a side panel when the panel closes (the prototype drops it to `body`). Focus never lands on `body` after an action.
- **Global pages** (`src/routes/__root.tsx`): 404 "Page not found" + "Go home"; error "This page didn't load" / "Something went wrong on our end. You can try refreshing or head back home." + "Try again" / "Go home". The prototype draws these with shadcn classes; the rebuild draws them with tokens.
- **Prototype-only copy**, not to be ported: the "Prototype · synthetic data only" badge, "Scan is simulated in this prototype.", "This page can't be shown in the prototype.", "The content store is not locked in this prototype.", "Retention periods here are demo values…", "Prototype: do not add real customer files.", "Reset test data".

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
