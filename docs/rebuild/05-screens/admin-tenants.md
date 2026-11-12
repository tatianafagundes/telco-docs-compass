# Tenants (group)

- **URL:** `/admin/tenants and /admin/tenants/{tenantId}`
- **Who:** master_admin

## Purpose
Group view of its countries: counts only, plus settings (Documents count, Document types, Policies). Never document names (ADR-08).

## Layout and actions
Intro: "You see counts and settings. Document names and content stay inside each tenant." Per child card: "<Name> overrides N types, adds M. K documents.", "Sharing with other organisations: <crossTenantShare>", counts By type, By status, By processing, "View settings and counts". Child view: banner "Read-only" "Viewing <child> as <group> – counts and settings only" + "Back to tenants"; sections Documents (counts), Policies (cards), Document types (table + read-only panel, reason "Read-only view."). Known copy defects the rebuild must not copy: the tab, submenu and page title say "Tenants"/"tenant" (a word the kit's Copy rule forbids; the original brief asked for it, so the term is the owner's decision); counts "By type" show raw codes ("orderAttachment") instead of display names and the sharing mode shows the enum ("explicitGrant"); the "Read-only" banner uses the purple tone with the Sparkles (AI) icon. The "Usability test" card with "Reset test data" is prototype only.

## States
Empty: "No organisations yet". Unknown or foreign tenant: "This organisation isn't available to you."

## Accessibility
- Every action is reachable by keyboard. Unavailable actions use `aria-disabled` and show the reason as visible text.
- Dialogs return focus to the control that opened them. Targets are at least 24 px.
- Status is never shown by colour alone.

![Tenants (group)](img/admin-tenants-1280.png)

![Tenants (group)](img/admin-tenant-se-1280.png)

![Tenants (group)](img/admin-tenant-se-792.png)
