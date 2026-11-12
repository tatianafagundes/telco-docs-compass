# 11 — OpenSearch index

Index `erad-documents-v1`, alias `erad-documents`. Use one shared index with tenant routing (`_routing = tenant_id`), or one index per tenant for very large tenants.

## Mapping
```json
{
  "settings": { "number_of_shards": 6, "analysis": { "normalizer": { "lc": { "type": "custom", "filter": ["lowercase", "asciifolding"] } } } },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "id":              { "type": "keyword" },
      "tenant_id":       { "type": "keyword" },
      "name":            { "type": "text", "fields": { "sort": { "type": "keyword", "normalizer": "lc" } } },
      "description":     { "type": "text" },
      "record_names":    { "type": "text" },
      "entity_ids":      { "type": "keyword" },
      "entity_types":    { "type": "keyword" },
      "document_type":   { "type": "keyword" },
      "status":          { "type": "keyword" },
      "sensitivity":     { "type": "keyword" },
      "legal_hold":      { "type": "boolean" },
      "pending_required":{ "type": "integer" },
      "needs_review":    { "type": "boolean" },
      "expiry_date":     { "type": "date" },
      "updated_at":      { "type": "date" },
      "deleted":         { "type": "boolean" },
      "visible_user_ids":   { "type": "keyword" },
      "visible_tenant_ids": { "type": "keyword" },
      "share_expiry":    { "type": "object", "enabled": false }
    }
  }
}
```
- `visible_user_ids` is the union of the users with entity_access on any related record and the users with an active share.
- `visible_tenant_ids` holds the tenants with an active cross-tenant grant.
- `entity_ids`, `entity_types` and `record_names` are returned in a hit only when the caller can read that record (BR-093); for shared-only and cross-tenant hits the DTO carries no record id. Record-id text matching is restricted to records the caller can open. See `04` "Effective role" and review ADR-R01/R02 for the scale of `visible_user_ids` and share expiry.
- Expiring shares and grants are re-indexed by a job at expiry time. The rebuild must also re-check `canSee` on results, so an expired share never shows.

## Access filter (mirror of `_doc_search_where`)
```json
{ "bool": { "filter": [
  { "term": { "deleted": false } },
  { "bool": { "should": [
      { "bool": { "filter": [ { "term": { "tenant_id": "<caller.tenant>" } },
          { "bool": { "should": [
              <if tenant_admin> { "match_all": {} },
              { "term": { "visible_user_ids": "<caller.id>" } } ] } } ] } },
      { "term": { "visible_tenant_ids": "<caller.tenant>" } } ], "minimum_should_match": 1 } }
] } }
```

## Queries
- **Search:** `multi_match` over name^3, description and record_names, combined with the filters from BR-100.
  - Sort: `[{updated_at: desc}, {id: desc}]`, or `name.sort`, or `expiry_date`.
  - Paging: `size: 51` and `search_after`.
- **Count:** `track_total_hits: 10001`, giving "More than 10,000".
- **Facets:** `terms` on document_type, status, sensitivity and entity_types (`size` 30), under the same filter.
- **Bulk ids:** a point-in-time plus `search_after` scroll, capped at 10,000 ids.
- **Landing lists:**
  - Recent: sort by updated_at.
  - Waiting for you: status=in_review.
  - Expiring: expiry_date in the next 90 days.
  - Holds: legal_hold=true.

## Sync
- The indexer consumes the outbox. For each document id it reloads the full document from Cassandra, then indexes or deletes it (purged documents are deleted from the index).
- Indexing is idempotent per (id, updated_at).
- A full reindex reads `documents_by_id` with a token-range scan into a new index, then swaps the alias.
- Changes to access (record access, shares, grants) also emit outbox rows, so the visibility fields update.
- Lag SLO: under 5 s at p95. Show "Updating…" when a person's own change isn't indexed yet.
