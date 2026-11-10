# Documents (search)

- **URL:** `/documents`
- **Who:** any signed-in person (results follow the visibility rule)

## Purpose
Search-first entry point for millions of documents (see 08).

## Layout and actions
Landing lists: "Waiting for you" (empty: "Nothing needs checking right now. Nice work."), "Recently changed" with See all, "Expiring in the next 90 days" (empty: "Nothing expires in the next 90 days."), and On legal hold (admins). The search hint reads: "Names, descriptions, confirmed details, or an order, quote or contract number." Search box (label "Search documents", "Clear search"); identifier-like queries show "Matching records" with Go to record. Filters persist in the URL; "Clear all" / "Clear all filters". Sort (updated, name, expiry). Count label per BR-103. Rows open the document in a side panel. Select rows or all results to start a bulk change (BR-105–108). Saved views: personal, team views for admins.

## States
Loading: skeleton rows. Error: "Documents couldn't load" / "The results couldn't load just now." + **Try again**. Empty: "No documents match" + Clear all filters.

## Accessibility
- Every action is reachable by keyboard. Unavailable actions use `aria-disabled` and show the reason as visible text.
- Dialogs return focus to the control that opened them. Targets are at least 24 px.
- Status is never shown by colour alone.

![Documents (search)](img/documents-1280.png)

![Documents (search)](img/documents-792.png)
