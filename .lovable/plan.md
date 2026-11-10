# Plan: "Documents" – telecom document management SaaS (ERAD design)

Built in the 9 phases your prompt files define, using your DESIGN.md (ERAD library), with Lovable Cloud as the backend.

## Roles I will play

| Role | What it owns in this build |
|---|---|
| Product manager | Scope per prompt, acceptance criteria, "customer-first" checks: can an agent answer a customer from the key facts in under 10 seconds? |
| UX / interaction designer | Apple-like calm: one primary action per view, clear states, no dead links, reasons shown for anything unavailable |
| Visual designer | ERAD tokens, light/dark themes, typography (Ericsson Hilda + fallbacks), layers |
| Accessibility specialist | WCAG 2.2 AA: keyboard paths, focus-visible, aria-disabled with visible reasons, reflow at 200% zoom (1.4.10), colour + word + icon on every status |
| Frontend engineer | Shell, primitives, tables, preview panel, upload, versions, review, search |
| Backend / data engineer | Schema, seed, document operations from the OpenAPI seam, audit trail |
| Security & compliance officer | Tenant isolation, row-level access, no public sign-ups, legal hold, quarantine, GDPR / ePrivacy, eIDAS signature levels, ISO 27001-style audit |
| Telecom domain expert | TM Forum alignment (SID entities: Quote, Order, Account, Customer; Open APIs TMF667 Document, TMF651 Agreement), contract lifecycle, retention |
| AI / extraction specialist | Field extraction with mandatory human confirmation – never shows an unconfirmed AI value as fact |
| QA engineer | Tests for rules: permissions, hold blocks delete, approval gate, quarantine never downloadable |
| Technical writer / localisation | Copy in your brand tone, PT-BR / EN / ES strings |

## Phases (one per prompt file)

1. **Foundation** – tokens, theme toggle, ERAD primitives (button, fields, table, side panel, dialog, tags…), app shell with header "Prototype · synthetic data only", left nav, zoom reflow.
2. **Backend** – enable Lovable Cloud, apply your schema + synthetic seed, email sign-in only (no sign-up), 5 demo users on @example.test, document operations as server functions, audit log.
3. **Entity documents** – Quotes/Orders/Accounts/Customers list, record page, Documents tab with "needs attention" count, filters, table states.
4. **Preview panel** – 356px panel, key facts block, page preview, state-driven primary action.
5. **Upload pipeline** – Uploading → Scanning → Reading → Ready / Failed / Quarantined.
6. **Versions** – history, add version, signed labels.
7. **Extraction review** – confirm/edit AI-read fields; approval gated on required fields.
8. **Access & activity** – share/revoke, activity trail.
9. **Search** – cross-entity search (nav item appears only then).

Each phase: the 5-line plan your prompts ask for, then build, then verify in the browser and with tests.

## What I need from you before phase 2

The prompts refer to files that were not uploaded:
- `src/styles/tokens.css`
- `supabase/migrations/001_documents_schema.sql` and `supabase/seed/002_synthetic_seed.sql`
- `contracts/` (document.openapi.yaml, schemas) and `docs/ui-references.md`
- The Ericsson Hilda font files (licensed – otherwise fallback fonts are used)

Phase 1 can start now; I will rebuild tokens from DESIGN.md if tokens.css is missing.

## Technical notes
- The prompts target Supabase Edge Functions; this project uses TanStack Start, so the seam becomes server functions with the same operation names and contracts.
- Roles in a separate `user_roles` table with a `has_role` check; RLS on every tenant table.
- Services layer in `src/services/`, Zod schemas in `src/schemas/`, react-i18next with PT-BR fallback.
