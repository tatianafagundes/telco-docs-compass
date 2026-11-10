# Plan: build phases 1 and 2 with your files

All missing inputs have arrived: tokens, schema (15 tables), synthetic seed, OpenAPI seam (document operations) and 4 JSON schemas. Still missing: `docs/ui-references.md` and Ericsson Hilda font files (fallback fonts will be used).

## Phase 1 – Foundation (continue)
- Replace the token file I rebuilt from DESIGN.md with your `tokens.css` (keep the added lighter dark-mode focus colour, recorded as a divergence).
- Finish ERAD primitives: text field, select, checkbox, radio, tag, pill, tooltip, table, card, side panel, dialog, tabs, toast, divider, breadcrumb, empty state, spinner, skeleton, plus the gap components (text tab bar, destructive button, progress bar, banner, skeleton row, avatar).
- App shell: 48px header ("Documents", "Prototype · synthetic data only", tenant, theme toggle, user menu), 240px navigation (Documents, Admin; Search hidden), collapse to 80px below 1280px.
- `/design` review page with every primitive and state in light and dark.
- `docs/decisions/01-foundation-gaps.md` listing the added components and why.

## Phase 2 – Backend
- Enable Lovable Cloud; apply your schema exactly, then the seed. Stop and report if any statement fails.
- Email/password sign-in only, public sign-ups off; ERAD sign-in card; "No access assigned. Ask an administrator." for users without a role.
- Create the 5 demo users on `@example.test` via a one-time admin script, run `seed_demo_access`, then drop it. You set passwords.
- Document operations from `document.openapi.yaml` as authenticated server functions (same operation names, Zod schemas from your JSON schemas), with `recordAccess` limited to view/download and every other audit event written server-side.
- Typed `api.ts` service used by the UI.

Then pause for your OK before phase 3 (the 5-line plan your prompt asks for).

## Technical notes
- Server functions replace the Supabase edge function (this stack does not use edge functions); the contract stays identical.
- Tests: role access rules, viewer cannot reach the restricted dispute document, recordAccess rejects other actions.
