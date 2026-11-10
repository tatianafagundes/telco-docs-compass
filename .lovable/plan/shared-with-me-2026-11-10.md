# Shared with me

## Goal
People who were given access to a single document (a one-off exception) can find and open it, even when they cannot see the record it belongs to. They never see the record's name, its other documents, or who else has access.

## What the person sees
- A new **Shared with me** item in the left navigation, shown to everyone. It shows a count when there is at least one.
- The list: document name, type, status, access level ("Can view" / "Can edit"), who shared it, when, and the end date if there is one. Expired or removed shares disappear. Sorted newest first, 20 per page.
- Empty state: "Nothing has been shared with you yet. When someone shares a document directly, it will appear here."
- Opening a row shows the document on its own page: same document panel (details, versions, open/download, activity on this document), but the record line reads "Part of a record you don't have access to" instead of the record name, with no link.
- "Why can I see this?" says: "Because {name} shared it with you directly{, until date}."
- Actions follow the share level and role rules already in place; Manage access and anything that changes the record stay hidden for shared-only access.
- If a person can also see the record, the row links to the normal record view instead.

## How it is protected
- The list only returns documents with an active one-off share for the signed-in person, read as that person (existing access rules), so other countries and other people's shares can never appear.
- Record name and details are not returned at all for shared-only documents; the screen does not just hide them.
- Opening the document records a normal "view" activity.

## Technical details
- New `listSharedWithMe` server function in `src/services/document.functions.ts` (`requireSupabaseAuth`, RLS): reads `document_access_exceptions` where `user_id = me` and not expired, joins `documents`; for each, checks whether the caller can read any related `business_entities` row (RLS) to set `recordVisible` and, only then, `entityId`. Granter display name from `profiles`.
- New pure helper in `src/services/document-actions.ts` / `review-rules.ts`: `sharedOnly` context hides record-scoped actions and produces the "shared directly" explanation; tests added in `src/services/__tests__/`.
- New routes: `src/routes/_authenticated/shared.tsx` (list) and `src/routes/_authenticated/shared.$docId.tsx` (standalone document view reusing `DocumentPanel` with a `recordContext: "hidden"` prop).
- `use-shared.ts` hook, `api.ts` wrapper, nav entry in `app-shell.tsx`, query keys `['shared-documents', page]`.
- Integration test (RUN_ACCESS_TESTS): share a document with SE Viewer, confirm it lists, record name is absent, and NO Manager's list stays empty.
- Browser check as SE Viewer: share from SE Manager, open from Shared with me, confirm no record details, then remove the share and confirm it disappears.
- No database schema change expected; existing visibility rules already allow this.
