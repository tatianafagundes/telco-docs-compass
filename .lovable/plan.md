# Documents page built for millions of documents

## Where we are today
- The Documents page loads **every record** the person can see in one go, then filters them in the browser. That's fine for 21 documents. At millions, the page would freeze or time out.
- Search matches names with "contains" (`ilike '%…%'`) and asks for an exact total count on every query. Both get slow on big tables.
- Right now, no document can be reached without first opening its record.

## How large systems handle this (market patterns)
- **Search first, not browse first** (Box, M-Files, OpenText, SharePoint, Google Drive): the start page is a search box with recent and "my work" lists, never a full list.
- **Facets** (Salesforce, ServiceNow, Elastic-based DMS): narrow results by type, status, record, date, sensitivity and owner, with counts next to each option.
- **Exact identifiers first** (telecom OSS/BSS, Amdocs, Netcracker): typing an order, quote, contract or ticket number jumps straight to it.
- **Cursor paging and virtual scrolling** (Gmail, Jira, Linear): fetch 50 rows at a time, show "about 1.2M" rather than an exact count, and only draw the rows on screen.
- **Saved views** (Jira filters, Salesforce list views): "Waiting for my review", "Expiring in 30 days", "On legal hold", shared across a team.
- **Bulk actions run in the background** (M-Files, SharePoint): select up to a set limit, or "all matching this filter", run it as a job with progress, undo where possible, and record every item in the activity log.
- **Edit where you are**: a side panel for one document, and bulk edit for many. No full-page forms.

## What we build

### 1. New Documents start page
- One search box at the top. It understands numbers (O-7731, Q-2026-0412, a contract number) and jumps straight to the match.
- Below it, without a search: **Recent**, **Waiting for me** (review or details to check), **Expiring soon**, **On hold** (for admins). Each shows its first 10 with "See all".
- Records (orders, quotes, accounts) stay available as a filter, not as the whole page.

### 2. Results view
- A table with chosen columns: name, type, status, record, last changed, sensitivity, flags (hold, details to check).
- Facet filters on the left with counts: type, status, record type, changed date, sensitivity, hold, needs review.
- Sorting on a few indexed columns only, so it stays fast.
- 50 rows at a time, with more loading as you scroll. Only visible rows are drawn. The total shows as "about 1.2 million" when exact counting would be slow.
- The search and filters live in the page address, so a view can be bookmarked and shared.
- Saved views: personal ones, plus team views set by admins.

### 3. Viewing and editing
- Clicking a row opens the existing document panel on the side, and the results stay in place.
- Keyboard: arrow keys move between rows, Enter opens, Escape closes.
- Bulk select: tick rows, or "select all 12,430 matching". Supported actions: change status, place or release hold, change sensitivity, add to record. These run as a background job with a progress bar and a summary of what was skipped and why (frozen, held, no permission).

### 4. Backend for scale
- Full-text search in the database (name, description, confirmed details, record number) with a ranking. A trigram index for partial number matches.
- Indexes matched to the facets and sorts, always starting with the organisation, so country isolation stays fast too.
- Cursor ("keyset") paging instead of offsets. Estimated counts for big results, exact counts under 10,000.
- Facet counts from one grouped query, capped and cached for a short time.
- Background jobs table for bulk actions, processed in batches by the scheduler. Each item is checked against the same rules and audited.
- The TMF667 API moves to the same search and cursor paging, so connected systems scale as well.

### 5. Proof
- Load about 1 million synthetic documents into a test copy and time the main searches (target: under 300 ms for the first page).
- Re-run the country isolation and share tests.
- Keyboard and screen-reader pass on the new table and filters.

## Open decisions for you
1. Search engine: database full-text search (no new service; good to tens of millions of rows) or a separate search service later if you need typo-tolerance across languages.
2. Bulk limit: suggestion is 10,000 documents per job.
3. Who can create team saved views: admins only, or managers too.

## Technical details
- New `search_documents(p_query, p_filters jsonb, p_cursor, p_limit)` SECURITY INVOKER SQL function (RLS still applies); `tsvector` generated column plus GIN index; `pg_trgm` GIN on name and related entity ids; composite btree indexes `(tenant_id, status, updated_at desc, id)`, `(tenant_id, document_type, updated_at desc, id)`.
- `facet_counts(p_query, p_filters)` returns grouped counts, capped at 10,000 per bucket.
- Estimated counts via `EXPLAIN` row estimates above a threshold.
- `saved_views` and `bulk_jobs` / `bulk_job_items` tables with RLS and grants; worker route secured by the managed scheduler auth.
- UI: TanStack Query `useInfiniteQuery`, search state in route search params (validated with Zod), row virtualisation implemented in our ERAD table without a new library.
- Pure rules (cursor encode/decode, filter parsing, bulk eligibility) in `src/services/search-rules.ts` with tests.
