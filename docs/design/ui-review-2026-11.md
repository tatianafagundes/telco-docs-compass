# UI review, November 2026

A holistic review of the screens of Telco Docs Compass: who uses it, how each journey feels, what is good, what is not, and how close it is to the Ericsson Design System (EDS). It ends in a prioritised backlog.

## How it was done, and its limits

- **Screens:** every screen was opened in a real browser as five demo accounts (viewer, manager, country admin, group admin, a manager of another country), in light and dark, at 1440, 1280 and 400 px, with an automated WCAG 2.2 AA scan (axe-core) on each.
- **EDS:** token values were checked with the EDS token tool; patterns were read in the EDS documentation (navigation, tag, tab, dialog, filter, empty state, file upload, UX writing).
- **Two reviewers read the evidence** (screenshots, code, a findings pack): a design reviewer (EDS adherence, visual design) and a UX researcher (journeys per persona, heuristics). Where they read little code, their code claims were checked before they went in here.
- **Grades.** OBSERVED: seen in a screenshot or browser run. CODE: read in code. INFERENCE: reasoned, needs a test.
- **Limits.** No users took part, so nothing here is a user finding. No screen reader was used. There is no demo account for the contributor or reviewer, so those two personas were judged from the role rules and code. The bulk change dialog, the key reveal after connecting a system, and the make-effective, supersede and archive screens were not seen.
- **A correction to earlier reports.** Browser checks I ran earlier in this project and called "dark" used the wrong switch and were really light. The app's theme is the `data-theme` attribute plus `localStorage["erad-theme"]`. All screens and the add-documents dialogs were re-run in real dark today: no findings.

## Summary

- The product model is clear and the screens are calm. Country isolation, soft delete with undo, reasons on holds, and unavailable actions that explain themselves are strong and should be protected.
- Tokens match EDS. Components are an own implementation (ERAD) that copies EDS values, not EDS components, so patterns drift. The main EDS gaps are tags (icons and long labels on coloured tags), dialogs (no 60 percent overlay, except the newest), tabs used as navigation, and inconsistent lists and tables.
- The weakest journey is **approving a document**: the check-details page can contradict itself and offers no way to enter the missing detail.
- Hover-only row actions hide Release and Restore from touch and from anyone who does not hover.
- Three defects were fixed during the review (see "Fixed").

## Personas

| Persona | Role | Demo account | Goals | Sees in the navigation |
| --- | --- | --- | --- | --- |
| Reader | viewer | yes (Sweden) | find and read what they may see | Documents, Shared with me |
| Contributor | contributor | no (code only) | get files into the right record, send them for review | same as Reader |
| Reviewer | reviewer | no (code only) | check details read from a file, approve a colleague's document | same as Reader |
| Manager | manager | yes (Sweden, Norway) | move documents through their life, holds, delete and restore, share, bulk changes | adds Holds and retention |
| Country admin | tenant_admin | yes (Sweden) | document types, policies, connected systems, permanent deletion | Documents, Shared with me, Admin (4 tabs) |
| Group admin | master_admin | yes | group rules and locks; counts and settings of the countries, never documents | Documents, Shared with me, Admin (adds Tenants) |
| Other-country user | manager of another tenant | yes (Norway) | must see nothing of another country | as Manager |
| Integrator | API caller | n/a | uses the TMF667 API; the UI part is the admin who connects them | n/a |

## Journeys at a glance

| Journey | Main persona | Verdict | The one reason |
| --- | --- | --- | --- |
| J1 Find a document and open it | Reader, Manager | **good** | search-first page with counts; "Uploading" tags next to "In review" look stuck |
| J2 Add documents | Contributor | **mixed** | two clear routes now; whether people stall on choosing a record is untested |
| J3 Check details and approve | Contributor, Reviewer | **weak** | the page that resolves a block says "nothing to check" |
| J4 Move a document along its life | Manager | **good** (CODE) | one next step per status; not seen in the UI |
| J5 Legal hold, retention, delete, restore | Manager | **mixed** | rules are explained well; Release and Restore are invisible until hover |
| J6 Share and receive a share | Manager, Reader | **mixed** | strong privacy model; "Can edit" promises more than the server applies |
| J7 Bulk change | Manager | **not rated** | the dialog was not seen |
| J8 Configure types and policies | Country admin, Group admin | **mixed** | inheritance is visible, but repeated on every field |
| J9 Connect a system | Country admin | **mixed** | least-privilege setup; the list cannot cope with many systems |
| J10 Group oversight | Group admin | **mixed** | clear once there; the landing page is for people who work with documents |

## What hurts, by journey

**J3 Check details and approve (weak).**
- OBSERVED: for a document whose type requires a detail that was not read, the page says "Nothing to check here ... you can go straight to approval", the footer says "1 required detail needs checking", Approve is disabled, and the stepper shows "Check details" as done in the panel and on the page. The only way out is Back to document, then Edit details.
- OBSERVED: the start page tells the same manager "Nothing needs checking right now. Nice work." while 25 documents are in review.
- CODE: the four-eyes refusal ("you added this, so you can't approve it") has its rule but no screen was seen for it.
- INFERENCE: "Send back" and "Report a problem" may read as the same action.

**J5 Holds, delete, restore (mixed).**
- OBSERVED and CODE: the Release and Restore buttons in the table have `opacity-0` until the row is hovered or focused (`src/components/erad/data-table.tsx`). Keyboard users get them on focus; touch users and anyone who does not hover do not see them.
- OBSERVED: the delete dialog said "an administrator can restore it later", but a manager can restore. Fixed (see below).
- OBSERVED: "Verify hold" at the top of the Holds table is not explained.

**J2 Add documents (mixed).**
- Works: one primary action; viewers and the group administrator see it unavailable with the reason; the picker opens from the click; "Choose a different record" at every step; focus returns to the button after cancelling.
- CODE: the record search matches the start of a name or the exact number, so "Fibre" does not find "O-7731 Fibre upgrade". INFERENCE: this may cause wrong or abandoned choices.
- OBSERVED: the same document row repeats "Quote · in Order O-7731 · Fleet connectivity, 12 sites" as an underlined link on every row (the design reviewer asks whether it competes with the title; to test).

**J6 Share (mixed).** The privacy model is strong (record not named, nothing leaks). The share level "Can edit" is not applied by the server, see `docs/architecture/sharing.md`. There is no screen for sharing with another organisation.

**J8 and J9 Admin (mixed).**
- OBSERVED: the type editor repeats the same tag and the same sentence ("... lets this organisation add to its types, not replace their settings") under five or more fields.
- OBSERVED: Connected systems lists every disconnected system as a tall card (12 or more in the demo, test leftovers) with no count, filter or collapse. "Disconnected" is red, a normal state in the danger colour.
- OBSERVED: the group tenant detail shows raw type codes ("orderAttachment", "regulatoryFiling") where everywhere else the labels are "Order attachment", and policy cards that stop mid-sentence ("Replaces the group's").
- OBSERVED: a tenant admin who types `/admin/tenants` (a group-only page) waits about 8 seconds on "Loading your workspace" and then reads "This page didn't load. Something went wrong on our end." It is a permission case, not a server fault.

**J10 Group oversight (mixed).** OBSERVED: the group administrator signs in to the Documents page, whose lists are empty by design. The "Add documents" button I added was available to them: fixed (see below). INFERENCE: the landing page would be better as Admin.

## EDS adherence

| Layer | Verdict | Evidence |
| --- | --- | --- |
| Tokens (colour, focus, status, font) | **adherent** | primary `#1174e6`, hover `#0069c2`, press `#005499`, focus purple `#a56ebe` light and `#8e45b0` dark, tag and status colours: equal to the EDS token values; both themes pass axe. The font family was not checked (the EDS token tool listed only font weights) |
| Type scale, spacing, radius | **not verified** against EDS; the design reviewer sees a flat type scale (page title, panel title and section labels within 2 to 3 px) | JUDGEMENT from stills |
| Components | **partly**: own React set (`src/components/erad`) with EDS values, not `@eds/vanilla` or `@dsi/react-eds`; no counterpart for Notification (custom banner), Pagination (infinite scroll instead), Breadcrumbs (a text link) | code |
| Patterns | **partly**, see below | |

| EDS rule (from the EDS documentation) | In the app | Verdict |
| --- | --- | --- |
| Tag: non-interactive, label within 20 characters, no icons on coloured tags, one colour convention | "Locked by Aurora Telecom Group" and "From Aurora Telecom Group" (25 to 30 characters) with lock, check and info icons; status tags use the severity tone model | **not adherent** |
| Dialog: overlay 60 percent, at most two actions, use sparingly | legal hold, manage access, delete, connect a system and the types step have no overlay; the new dialogs use 40 percent; the dialogs seen have two actions | **partly** |
| Tab: parallel content, never primary navigation, one row | Admin tabs hold different areas (types, policies, holds, systems, tenants); "Holds and retention" is also a left-nav item for managers | **not adherent** |
| Navigation: home link always visible, local navigation in the app nav container, visibility can be toggled | flat left list, app name as home; no item highlighted on child pages; no user toggle | **partly** |
| Filter: batch or interactive, panel can collapse, zero results use the empty state | interactive facets, always open, empty state present | **partly** |
| Empty state: short message plus a next step | present everywhere seen | **adherent** (apart from the contradictions in J3) |
| File upload: drop area plus browse link, per-file progress, retry, completed files as pills | drop zone plus Choose files, a type step per file, a progress panel; deliberate differences (type is required, progress per file) | **partly, by design** |
| UX writing: sentence case, EDS terminology (Log in, Log out, Add, Create, Delete, Edit, Cancel, Manage), no periods on buttons | sentence case and plain copy throughout; "Sign in" and "Sign out"; "Connect a system" | **mostly**; terminology to confirm with the design owners |
| Skip link (EDS component) | none; the first Tab lands on an icon button in the top bar | **not adherent** (and WCAG 2.4.1) |
| Sparkle and gradient reserved for AI | "Read-only" tag on the group tenant detail uses a sparkle | **likely misuse** (INFERENCE) |

## Fixed during this review

1. **Open row unreadable in the light theme.** The row of the document open in the side panel is solid blue; its text was dark, 3.4 to 1 (WCAG needs 4.5 to 1). It only showed when the pointer was away from the row, because hover swaps the background, so earlier scans passed. Now white text, blue on hover; a test reads the real tokens. (`814d1c8`)
2. **Record link cut to an ellipsis.** At 1280 px with the panel open the record on the second line collapsed to "Quote · in …". Now a plain inline link cut by characters; a test guards it. (`814d1c8`)
3. **Group administrator offered "Add documents".** Now unavailable with "The group administrator works with settings and counts, not documents." Note: the server's `can()` ranks the group administrator like a country administrator, while the product rules say the role does not add documents; the server rule has not been changed (open question, R15).
4. **Delete dialog wording.** Now "a manager can restore it later from Deletion history".

## Backlog

**P1 is done (2026-11-23).** R1: a reviewer can enter a required detail that nobody read (it counts as confirmed), the stepper stays on Check details while a required detail is open, the footer says how many are left, and a required detail marked "not in the document" now says why approval waits. R2: row actions are always visible. R3: every dialog dims the page to 60%. R4: skip link. R5: the Tenants area tells other roles at once that it is for the group administrator. R6: field errors are announced. Checked in the browser in light and dark (axe: no violations); the save itself can only be checked on the preview (`docs/operations/regression-after-publish.md`). Open from it: a unique index on extraction details (version, name), which is a schema change to request in Lovable.

**P2 is done except R16 (2026-11-24).** R7: tags follow EDS (labels within 20 characters, "Inherited", "Changed here", "Locked", with the group named once per screen; no icons on coloured tags; held and locked items use a gray tag with a lock; severity icons only on error banners; Read-only uses a gray tag with an eye instead of the AI sparkle; the type editor shows a shared setting note once per section). R8: type labels and full policy sentences on the group's view of a country. R9: Connected systems shows a count, a filter from six systems, disconnected systems collapsed and gray, and a short "Can:" line. R10: the admin areas are children of Admin in the main navigation (EDS navigation tree) and each page is titled by its area; "Holds and retention" is one entry per role (managers in the main navigation, administrators under Admin). R11: the main navigation stays marked on pages inside a section. R12: a record lists its documents as a sortable table (Name, Type, Status, Changed). R13: "No file yet" instead of a stuck "Uploading". R14: the start page names its lists and shows reviewers what waits for approval. R15: the group administrator starts in Admin. R17: one primary action in the document panel, "Check details" while a detail blocks Approve, Send back in More actions. R18: one results toolbar row (count with the words searched for, Clear filters, Sort by). Checked in the browser in light and dark with axe: no violations, except `aria-hidden-focus` while a "More actions" menu is open (the Radix menu hides the page behind it; focus stays in the menu, so it is reported but not a trap). Open: R16 needs the design owners' term; the server still lets the group administrator add documents (product decision).
