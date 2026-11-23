# Sharing a document

Who can see a document besides the people of its record, how that is given and taken away, and what the person who receives it sees. The access model as a whole is in `docs/architecture/ARCHITECTURE.md` ("Tenancy and access"). The examples use the demo organisations Aurora Mobile Sweden, Aurora Mobile Norway and their group, Aurora Telecom Group, and the demo accounts named in `src/services/__tests__/access.integration.test.ts`.

## The kinds of access

| Kind | Table | Given by | Who can receive it | Lets them | Ends |
| --- | --- | --- | --- | --- | --- |
| Through the record | `entity_access` | set up with the record | people of the same organisation | see every document of the record | when record access is removed |
| Organisation admin | `user_roles` | the role itself | the `tenant_admin` | see every document of the organisation | when the role changes |
| Share with a person | `document_access_exceptions` | a manager or above, in Manage access | people of the same organisation | see this one document | on removal (row deleted) or at its expiry date |
| Share with another organisation | `cross_tenant_grants` | a manager or above, server only today | another organisation, when the sharing one allows it | see this one document, never change it | on removal (`revoked_at`) or at its expiry date |

The group (`master_admin`) never sees the documents of its countries, only counts and settings (`docs/decisions/2026-11-10-tenant-model.md`). The rule that decides what anyone can see is `can_see_document` in `drizzle/migrations/0000_documents_schema_v0_1_0.sql`; it checks expiry and removal on every read.

## Examples

### 1. Share a quote with a colleague who can't see its record

The Sweden viewer does not have access to quote Q-2026-0412 ("480 lines, 5G backup"). The Sweden manager wants them to read the signed quote.

1. The manager opens the document, then "..." and **Manage access**.
2. They search the viewer by name (only people of Aurora Mobile Sweden are offered), keep "Can view", optionally set "Until" to a date, and choose **Add**.
3. The activity of the document gets a `share` entry ("access given (can view)"). It names no person.
4. The viewer finds the document in **Shared with me**. It opens at `/shared/$docId` and shows "Part of a record you don't have access to": no record name or number appears on the page or in any server reply.
5. "Why can I see this?" says who shared it with them, and until when if the share expires.

Checked by `e2e/share-isolation.py` (steps 2 and 3).

### 2. Share with a colleague who can see the record

The same share, given to someone who also has access to the quote's record: **Shared with me** links them to the record as well, because they may open it. The share adds nothing they could not already see; it is useful when record access is about to be removed and this document must stay readable.

### 3. Share for a limited time

In Manage access, set **Until** (for example the end of an audit). The share lasts through that day, in UTC. The day after, the document disappears from the person's list and its direct link answers "This document isn't available to you, or it has been removed". Expired shares stay listed in Manage access as "Expired {date}" until someone removes them.

### 4. Take a share back

The manager opens Manage access and chooses **Remove** next to the person. From the next read the document is gone from their **Shared with me**, its direct link no longer opens, and no server reply contains it. The activity gets a `share` entry ("access removed").

Checked by `e2e/share-isolation.py` (steps 4 and 5).

### 5. Someone in another country follows a link

The Norway manager receives a link to the Sweden quote, to its record, or to its check-details page. Every one answers as not found, and no page or server reply contains a Sweden record or document detail. The document, its versions, details, activity, record links, shares and record access are all empty for them.

Checked by `src/services/__tests__/share-isolation.integration.test.ts` (with `RUN_ACCESS_TESTS=1`) and `e2e/share-isolation.py` (step 1).

### 6. Share with another organisation (server only)

Aurora Mobile Sweden wants Aurora Mobile Norway to read one contract.

- The Sweden organisation must allow it: its `cross_tenant_share` setting is `explicitGrant` (the default is `off`, which answers `access.crossTenant.off`).
- A manager or above calls `grantAccess` with the Norway organisation as subject, a level, a **reason** and an **expiry date**; both are required.
- Sharing with your own organisation is refused (`access.subject.sameTenant`).
- Norway's people then see the document. They can never change it: every write requires the document to be in the caller's own organisation, whatever the share says.
- Removing it sets `revoked_at`, so the history of who had access stays.

There is no screen for this yet (open in `roadmap.md`).

### 7. Who cannot share

A viewer, contributor or reviewer does not see **Manage access**, and the server refuses `grantAccess` and `revokeAccess` below manager. A document reached only through a share does not offer Manage access to the person who received it, whatever their role.

## The share level
A share is "Can view" or "Can edit". When someone reaches a document only through a share (not through one of their records, and not as the organisation's administrator), the server caps their role by the share's strongest live level (`shareCappedRole` in `src/services/document-rules.ts`, applied in `runWrite` and in bulk changes through `src/services/share-access.ts`):
- "Can view": nothing that changes the document, whatever their role. A Sweden contributor given "Can view" on a document outside their records is refused.
- "Can edit": a contributor's work at most (details, versions, sending for approval). Reviewing, approving and managing access need access to the record.
- An expired share counts for nothing.
- A share from another organisation never allows a change: every write requires the document to be in the caller's own organisation.
The `/shared/$docId` page takes the level from its address (`?level=`) to choose which buttons show. The server reads the share itself, so changing the address changes nothing it allows. Checked by `src/services/__tests__/share-level.test.ts` and `bulk-four-eyes.test.ts`.
## Where it lives

| Part | File |
| --- | --- |
| Giving and removing | `grantAccess`, `revokeAccess` in `src/services/document-access.functions.ts` |
| Who has access and why | `listAccess` in `src/services/document-read.functions.ts`, the explanation in `src/services/review-rules.ts` |
| Shared with me | `listSharedWithMe` in `src/services/document.functions.ts`, `src/routes/_authenticated/shared.index.tsx` and `shared.$docId.tsx` |
| The dialog | `src/components/access/manage-access-dialog.tsx`, `src/components/access/why-can-i-see.tsx` |
| Buttons for a shared-only document | `sharedOnlyRole` in `src/services/document-actions.ts` |
