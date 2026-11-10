# 01 — Product overview

## Purpose
ERAD is a multi-tenant document management service for a telecom group. Documents (contracts, quotes, order attachments, site surveys, etc.) always belong to **business records** that live in other systems: CPQ quotes, Order care product orders, CRM customers and accounts, Ticketing trouble tickets, and sites. ERAD keeps the file, its versions, the details read from it, who may see it, how long it must be kept, and a full activity trail. Connected systems use it through a TMF667 v4 API.

Customer-first principles that the rebuild must keep:
- **Folders don't exist.** A document is found through the records it belongs to, or by searching.
- **Nothing is approved on a machine's word.** Details read from a file are confirmed by a person before approval, and the system never auto-accepts them.
- **Every unavailable action says why.** Buttons are never silently disabled (see `13-angular-frontend.md`).
- **Countries are isolated.** Sweden never sees Norway. The group (master) sees counts and settings only, never documents.
- **Undo is preferred to confirmation.** Deletion is soft and recoverable. Permanent deletion is a separate admin action that leaves a tombstone.

## Telecom standards alignment
| Standard | Use |
|---|---|
| TM Forum SID | Document, DocumentSpecification, Attachment, RelatedEntity (ProductOrder, Quote, Agreement, BillingAccount, Customer, TroubleTicket, Site) |
| TMF667 v4 Document Management | External API (`06-api/tmf667.md`) |
| TMF630 REST guidelines | Paging (`offset`/`limit`, `X-Total-Count`, `X-Result-Count`), `fields`, error object, `@type`/`@schemaLocation` extensions |
| TMF688 Event | Hub/listener pattern, `DocumentCreateEvent`, `DocumentStateChangeEvent`, `DocumentAttributeValueChangeEvent`, `DocumentDeleteEvent` |
| Related entity APIs | TMF622 Product Order, TMF648 Quote, TMF621 Trouble Ticket, TMF629 Customer, TMF666 Account (referenced, not implemented) |

## Personas and roles
Each person has **one tenant and one role** (`user_roles` primary key = user_id). Roles are ranked as follows (`src/services/document-rules.ts`):

| Role | Rank | Capability |
|---|---|---|
| viewer | 0 | read what they can see |
| contributor | 1 | `edit`: add, change details, send for approval |
| reviewer | 2 | `review`: check details, approve, send back |
| manager | 3 | `manage`: make effective, supersede, archive, holds, delete, share |
| tenant_admin | 4 | everything in own country + sees every record in tenant + configuration |
| master_admin | 4 | group tenant only: counts and settings for child tenants, never document content |

Record access: a non-admin sees a document only through `entity_access` on one of its records, a direct share, or a cross-tenant grant (`04-security-and-tenancy.md`).

### Who can do what
| Action | viewer | contributor | reviewer | manager | tenant_admin | master_admin |
|---|---|---|---|---|---|---|
| View / download visible docs | Y | Y | Y | Y | Y | counts only |
| Add document / new version | – | Y | Y | Y | Y | – |
| Edit details (not frozen) | – | Y | Y | Y | Y | – |
| Send for approval (draft→in_review) | – | Y | Y | Y | Y | – |
| Confirm / correct details | – | – | Y | Y | Y | – |
| Approve (in_review→approved) | – | – | Y* | Y* | Y* | – |
| Send back (report problem) | – | – | Y | Y | Y | – |
| Make effective / supersede / archive | – | – | – | Y | Y | – |
| Legal hold place/release | – | – | – | Y | Y | – |
| Delete (soft) / restore | – | – | – | Y | Y | – |
| Share / manage access | – | – | – | Y | Y | – |
| Delete permanently | – | – | – | – | Y | Y (own tenant) |
| Document types, retention, connected systems | – | – | – | – | Y | Y (group, may lock) |

\* Approval also needs every required detail confirmed, and the approver must not be the person who added the document (four-eyes).

A person who reaches a document **only via a direct share** is capped by `sharedOnlyRole`: a view share gives viewer, and an edit share gives contributor at most.

## Demo tenants and accounts (synthetic)
- Tenants: `aurora` (master group), `se` Sweden, `no` Norway.
- Accounts (all `@example.test`): `master.admin`, `se.admin`, `se.manager`, `se.viewer` (only order `ord-se-7731`), `no.manager`. Passwords are not included in this pack.

## Main journeys
1. **Find:** search-first Documents page, or open a record and see its documents.
2. **Add:** drop files on a record, which runs a simulated scan, read and ready pipeline. The type is suggested, and size, type and duplicate checks run.
3. **Check details → Approve → Effective:** a guided page with a progress footer and four-eyes.
4. **Share:** grant a person view, edit or manage, optionally with an expiry. Shared documents appear under "Shared with me".
5. **Keep:** retention policy with a group hard floor, legal holds, deletion history, and permanent deletion.
6. **Configure (admin):** document types inherited from the group with lock, extend or override modes; connected systems with keys, scopes and limits.
7. **Integrate:** connected systems call the TMF667 API and subscribe to signed events.
