# Prompt 08 – Screen 6: access ("Why can I see this?") and activity

Read AGENTS.md and docs/ui-references.md (Dropbox f95e17c2 inherited vs exception; Drive ff1facad and 50679553; Notion 96246e2c). Plan first, wait for OK.

1. **Access dialog** ("Manage access", from the preview panel and row menu). Three layers, top to bottom:
   - Add people: field "Add people or teams" (search within the tenant only), role dropdown (Can view / Can edit), optional expiry date, "Add" button (seam `grantAccess`).
   - **Inherited from <entity>** section: one row per entity relation (e.g. "Order O-7731 · 4 people can view"), expandable to the people, each with role and an origin label ("via Order O-7731"). Inherited rows cannot be removed here; the row has a link "Open Order O-7731 to change this".
   - **Exceptions** section: explicit grants (person, role, granted by, expires) with "Remove access" (seam `revokeAccess`). Empty state: "No exceptions. Access follows the order."
   - General access is **always** "Restricted – only people with access". There is no public link in this prototype; say so in a helper line.
2. **Why can I see this?** A link in the preview panel opens a small explanation for the signed-in user: "You can see this because you can view Order O-7731" or "because [name] shared it with you until 30 Nov". If the user lost access mid-session, show a clear "You no longer have access" state, not an error toast.
3. **Group supervision and sharing with other organisations** (visible only to managers and tenant admins; never say "tenant" in the UI): a section "Other organisations" that shows grants with level, granted by, expiry and "Revoke access"; and the line "Aurora Telecom Group can see counts and states of your documents, never names or content." (read from tenant_policy.master_supervision). "Share with another organisation" opens a dialog requiring a named organisation, a level, an expiry (max 30 days) and a reason (seam `grantAccess` with subject type tenant; the prototype grants to everyone in that organisation, and the dialog says so: "Everyone at Aurora Mobile Norway will be able to open it"); confirmation text: "This lets people in Aurora Mobile Norway open this document until 30 Nov. Opening it in this app is recorded." Granted documents are read only through the edge function (which writes the audit row), never through direct table reads. Disabled with a reason when the tenant policy has crossTenantShare off.
4. **Activity tab** (preview panel and a full page): reverse-chronological audit with filters (Action, Person, Date range) as chips. Row: icon, sentence ("Elin B. downloaded version 3 · Signed"), time. Actions: view, download, share, status change, restore, hold, delete, access denied, pipeline state change. Never shows content or field values. Export is not in this prototype.

Permission rules: viewers see Why-can-I-see-this and Activity of what they can see; only managers/admins edit access; everything writes through `recordAccess`/the edge function with Idempotency-Key.

States: no exceptions, expired exception shown struck through "Expired 2 Nov", large number of people (paginate at 20), loading, error, read-only.

Verify at 1440 and 1920, light and dark, as se.manager, se.viewer, no.manager (must not see Sweden), and report in one line.
