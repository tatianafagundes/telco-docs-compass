# Prompts 10–12: group admin, retention and holds, hardening

Decision: the group admin (Aurora Telecom Group) manages shared rules for every country it owns. It sees **counts and settings only**. Document names and content stay inside each country. Work runs in order: 10, then 11, then 12. Each step ends with a check and a one-line report.

The three site survey PDFs (Malmö, Lund, Helsingborg, order O-7731) become test files for uploads and holds. Helsingborg is the low-resolution one, so we use it to test the "few details found" state.

## Step 1 – Prompt 10: countries and group rules
- **Admin › Document types**: a table of document types. Each setting carries one of three tags: "From Aurora Telecom Group", "Changed here" or "Locked by Aurora Telecom Group". Clicking a row opens a 356px side panel with every setting. A country admin can add a type, extend it or override it, and "Reset to group" undoes an override. When there are unsaved changes, one bar appears at the top: "Unsaved changes – Discard / Save". A setting below a group minimum is refused with a sentence that names the minimum.
- **Admin › Policies**: six cards. Each says in one sentence how this country relates to the group setting.
- **Tenants page** (group admin only): one row per country showing counts by type, status and processing state, plus what the country changed. The page says: "You see counts and settings. Document names and content stay inside each tenant."
- **User menu**: shows organisation and role. The group admin gets a "Tenants" submenu that opens a country's settings read-only, under a banner.
- **Before the group saves a shared rule**: an impact line, for example "Applies to 2 tenants. 1 tenant has overridden this…"
- Every settings change is recorded in the activity log (who, which setting, from → to).

## Step 2 – Prompt 11: retention and legal hold
- **Details tab**: the retention policy, "Keep until …" and the reason, including "Raised to 6 years by Aurora Telecom Group" when the group sets a longer minimum.
- **Legal hold dialogs**:
  - Placing and releasing a hold both need a reason. A reference number is optional when placing.
  - The dialog says what the hold does.
  - Once placed: "Hold applied to this record and all N versions. The content store is not locked in this prototype."
- **"Holds and retention" page**, with three tabs:
  - **Holds**: paged list of active holds, each with Release.
  - **Retention**: policies in force, how many documents each covers, and documents nearing their end date. Nothing is deleted automatically.
  - **Deletion history**: 30 days, each with Restore.
  - A "Verify hold" report button.
  - Managers reach the page from Documents; admins from Admin.
- **Delete permanently**: admins only, and only when there is no hold and the keep-until date has passed. Otherwise you see the exact reason. The red button appears only on the final confirm.
- **Expiry**: documents past their expiry date switch to "Expired" when opened or listed.
- The page notes that retention periods are demo values and need legal input.

## Step 3 – Prompt 12: hardening review
Work through the checklist and report a table (item, result, what changed):
- colours and spacing
- every screen state
- layouts at 1440/1920 in light and dark
- keyboard and screen-reader path
- security scans, fixing blockers
- contract checks: repeat-safe writes, 409 when the same key comes with a different body, attempts to bypass from the browser fail
- country isolation, proven as no.manager, master.admin and se.viewer
- copy review
- decision notes in docs/decisions/
- a "Reset test data" button for the group admin only

Final report: open issues, unverified assumptions, and the server region.

## Technical details
- Add the `master_document_stats(p_tenant)` security-definer function: aggregate counts only, callable only by a master_admin of the parent. Add read access to child `tenants` and `effective_specifications` for that admin. The no-document-access RLS stays unchanged.
- New server functions in a separate `src/services/tenant-config.functions.ts`, following the existing seam pattern (requireSupabaseAuth, SeamResult, idempotency, audit event). Hard floors and locks are checked in pure functions in `src/services/tenant-rules.ts`, with tests.
- Use the existing documents columns for holds (`legal_hold`, `hold_reason`, `hold_set_by`, `retain_until`) and add hold reference/since fields. Hold and release reuse `setHold`. Permanent deletion is a new server function with the blocker rules from `document-rules.ts`.
- `reset-test-data` becomes a server function, not an edge function, matching the project rule. It is master_admin only and restores the seed.
- No new libraries. English only.
