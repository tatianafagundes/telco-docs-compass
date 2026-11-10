# Plan: sharing with people (prompt 08, part) and checking details before approval (prompt 07)

Both actions already work on the server. Sharing rejects people from other countries. Approval is refused while required details haven't been checked. Neither one has a screen yet. This plan adds the screens.

## Part A – Manage access (item 3)

Opened with "Manage access" in the document panel (managers and admins). Viewers see "Why can I see this?" only.

1. **Add people:** a field "Add people or teams" that searches names in your own organisation only. You choose "Can view" or "Can edit" and can add an end date (optional). Then "Add".
2. **Inherited from the record:** e.g. "Order O-7731 · 4 people can view", which you can open to see the names, each labelled "via Order O-7731". You can't remove them here. The link "Open Order O-7731 to change this" takes you to the record.
3. **Exceptions:** people added one by one, showing role, who added them and the end date, with "Remove access". Expired ones are struck through ("Expired 2 Nov"). If there are none: "No exceptions. Access follows the order."
4. **General access** always reads "Restricted – only people with access". A helper line says this prototype has no public links.
5. **Why can I see this?** A short explanation in the panel: "because you can view Order O-7731" or "because SE Admin shared it with you until 30 Nov".
6. Long lists show 20 people per page. Each step has its own loading, error-with-Retry and read-only state.

Sharing with another organisation (Norway) and the full Activity page stay for later.

## Part B – Check details before approval (item 4)

1. **In the panel:** if details still need checking, a banner reads "3 details read from this document need checking." with a "Review" button. The record list shows "3 to check" under the status.
2. **Approve stays unavailable** until they're done, with the reason "2 required details need checking" and a "Review" link next to it.
3. **Review screen:** the document page on the left (60%) and the list of details on the right (40%). Below 900px wide the page sits above the list.
4. **Each detail shows:**
   - the plain name ("End date", "Other party")
   - the value
   - where it was read ("Read from page 1: 'End date: 31 December 2029'")
   - a confidence tag in words (High, Medium or Low)
   - the buttons Accept, Edit and Reject
5. **Order and navigation:** Low confidence comes first. "Next to check" (or N) jumps ahead, and Ctrl+Enter accepts and moves on. Selecting a detail outlines its spot on the page with a matching number [1].
6. **Rules:**
   - Nothing is ever accepted automatically.
   - Editing keeps the original reading ("Edited – read as High: Fjärrvärme Syd AS").
   - Accepted or edited values are copied onto the document. The activity log names the detail but never its value.
7. **Wording:** the screen uses only "Not checked yet", "{n} to check" and "{k} of {n} to check".
8. **Test documents:** the Fjärrvärme Syd contract and the quote have details to check. The Nordlys contract shows the "all checked" state.

## Checks

- Sign in as the Sweden manager: share a document with SE Viewer, then remove it. The viewer's "Why can I see this?" text should follow.
- As the Norway manager: searching for people never shows Swedish names.
- Approve the Fjärrvärme contract after checking its details: approval is refused before and allowed after.
- Screenshots at 1440 and 1920, light and dark. Also check keyboard use for both dialogs.

## Technical details

- New read `searchPeople(query)`: the caller's own tenant only, from `profiles` joined to `user_roles`. It runs as the caller under RLS, which needs a `profiles` SELECT policy limited to the caller's tenant (I'll check this policy exists before relying on it). Returns at most 20 matches.
- Reuses `listAccess`, `grantAccess`, `revokeAccess`, `getExtraction` and `reviewExtraction`. Add `whyCanISee(id)` as a pure helper over `listAccess` items.
- Add pure helpers to `src/services/document-actions.ts`: `approveState()` (returns the pending count and reason) and `reviewOrder()`, plus field-label and confidence-band mappings, with tests.
- New components: `src/components/access/*` and `src/components/review/*`. The review opens as a full-width route `records.$entityId.review.$docId.tsx`, so "Close review" can return focus to the Review button.
- English only, no new libraries.
