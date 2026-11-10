# Next step: document write actions, and is it the right priority?

## Where we are
- The write actions already exist behind the scenes (Phase 2c): register, edit details, new version, restore, status changes, legal hold, delete/restore, report a problem, share/revoke, extraction review. Rule tests pass.
- None of them have been run by a real signed-in person yet. People also can't see or use them, because no screen opens a single record.
- The five demo accounts now exist, so the access checks we held back (Phase 2b) are no longer blocked.
- The loading failure we just fixed came from an access rule nobody had tested. It's an early sign of what untested access rules can do.

## Is building write screens the right priority? Each perspective weighs in

| Perspective | Verdict |
|---|---|
| Customer / product | Not yet. People first need to find a record and see its documents. A write button with nothing to act on is confusing. |
| Security & compliance | Prove access first. Tenant isolation, viewer limits and legal hold must be confirmed for real accounts before anyone can change data. |
| Telecom domain | Approve, supersede and legal hold carry legal weight (contracts, KYC). Test them end to end before showing them. |
| UX / Apple-like | Actions belong where the object is: in the record view and its preview panel. They should appear gradually, not as a wall of buttons. |
| Engineering / QA | The server side is built. The cheapest risk to remove now is running it as each demo account. |

Conclusion: still write actions, but in this order: verify, then give them a home, then surface them.

## Proposed order

### Step 1: Verify access and writes with the real accounts (Phase 2b, about half a day)
- Run an automated check signed in as each of the five accounts:
  - Sweden admin, manager and viewer see what they should.
  - The Norway manager sees no Sweden records.
  - The master admin sees statistics only.
- Run each write action once as an allowed role and once as a refused role. Confirm the friendly error and the activity entry.
- Confirm that a record under legal hold, or still within its retention period, cannot be deleted.
- Remove the temporary setup helper.
- Keep these checks as tests in the project.

### Step 2: Give actions a home (Phase 3 + 4 essentials)
- Clicking a record opens a record page with its documents list. Each row shows status and processing state.
- Clicking a document opens a side preview panel with details, current version and activity.

### Step 3: Surface write actions where they belong, the most common first
1. Edit details (name, description, dates) inline in the panel.
2. Status moves (send for review, approve, send back), using one primary button for the next logical step.
3. Report a problem; share and revoke access.
4. Legal hold and delete/restore under a "More" menu. These ask for a reason and show an undo where allowed.
- Not now: upload/new version (Phase 5) and extraction review (Phase 7), which need their own flows.

### UX rules for every action
- Show only what the person's role allows. Anything unavailable stays visible with a short plain reason (no hidden or greyed-out mystery).
- No "Are you sure?" dialogs. Use clear, specific confirmations for actions that can't be undone, and undo for reversible ones.
- Warm, sentence-case copy. Friendly error messages with Retry. The screen updates right after success.

## Technical details
- Step 1: Vitest integration suite signing in via password grant for each demo account. It calls the `api` facade or REST and asserts row counts and `SeamError` codes. It drops `seed_demo_access`.
- Step 2: routes `/_authenticated/records/$entityId`, plus the panel via search param `?doc=`. Data loads through loader + `ensureQueryData` → `api`.
- Step 3: one React Query mutation hook per action group. Invalidate `['documents', entityId]` and `['document', id]`. Idempotency key per user intent. Use existing ERAD primitives only, with no new libraries, English only.
