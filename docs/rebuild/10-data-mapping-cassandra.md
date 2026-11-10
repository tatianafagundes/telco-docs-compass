# 10 — Cassandra 5 data model (query-first)

Keyspace `erad`, NetworkTopologyStrategy, RF 3. Default consistency is LOCAL_QUORUM. Ids are `uuid` (time-based `timeuuid` where ordering matters).

> Cassandra has no joins, foreign keys, triggers or row-level security. Every screen query below has its own table. Writes update all affected tables in one logged batch, and access checks run in Java.

## Access patterns → tables
| # | Query (current source) | Table |
|---|---|---|
| Q1 | get document by id (get, TMF GET) | documents_by_id |
| Q2 | documents of a record, newest first (record page) | documents_by_entity |
| Q3 | records a user can access (listEntities, canSee) | entity_access_by_user, entity_access_by_entity |
| Q4 | records of a tenant (admin) | entities_by_tenant |
| Q5 | versions of a document | versions_by_document |
| Q6 | details of a document | extraction_fields_by_document |
| Q7 | shares of a document / shares for a user (Shared with me) | shares_by_document, shares_by_user |
| Q8 | cross-tenant grants of a document / for a tenant | grants_by_document, grants_by_tenant |
| Q9 | activity of a document, newest first, paged 20 | audit_by_document |
| Q10 | tenant activity (admin) | audit_by_tenant_day |
| Q11 | holds of a tenant | holds_by_tenant |
| Q12 | deletion history | deletions_by_tenant |
| Q13 | effective types | specifications_by_tenant |
| Q14 | idempotency | idempotency_keys |
| Q15 | systems by key hash / by tenant | integration_clients_by_key, integration_clients_by_tenant |
| Q16 | rate counters | api_rate |
| Q17 | outbox by time bucket | event_outbox_by_bucket |
| Q18 | due deliveries | event_deliveries_by_due, event_delivery |
| Q19 | subscriptions of a tenant | subscriptions_by_tenant |
| Q20 | landing lists (recent, waiting, expiring) | OpenSearch (no table) |
| Q21 | master counts | doc_counts_by_tenant (counter) |

## Selected DDL
```sql
CREATE TABLE documents_by_id (
  id uuid PRIMARY KEY,
  tenant_id text, name text, description text, document_type text,
  status text, pipeline_state text, pipeline_detail text, sensitivity text, signature_level text,
  effective_date date, valid_to date, expiry_date date, origin text,
  retention_policy_id text, retain_until date,
  legal_hold boolean, hold_reason text, hold_reference text, hold_set_by uuid,
  characteristic text,               -- JSON array
  external_identifier text,          -- JSON array
  current_version_id uuid, entity_ids set<text>,
  created_by uuid, created_at timestamp, updated_at timestamp,
  deleted_at timestamp, purged_at timestamp
);

CREATE TABLE documents_by_entity (
  entity_id text, updated_at timestamp, id uuid,
  name text, document_type text, status text, sensitivity text, legal_hold boolean, deleted boolean,
  PRIMARY KEY ((entity_id), updated_at, id)
) WITH CLUSTERING ORDER BY (updated_at DESC, id DESC);
-- on update: DELETE old (updated_at,id) + INSERT new in the same batch

CREATE TABLE entity_access_by_user (user_id uuid, entity_id text, tenant_id text, level text,
  PRIMARY KEY ((user_id), entity_id));
CREATE TABLE entity_access_by_entity (entity_id text, user_id uuid, level text,
  PRIMARY KEY ((entity_id), user_id));

CREATE TABLE versions_by_document (document_id uuid, created_at timeuuid, version_id uuid,
  label text, is_named boolean, note text, mime_type text, attachment_type text,
  size_bytes bigint, content_hash text, storage_key text, supersedes uuid, created_by uuid,
  PRIMARY KEY ((document_id), created_at)) WITH CLUSTERING ORDER BY (created_at DESC);
-- immutable: application never issues UPDATE on this table

CREATE TABLE extraction_fields_by_document (document_id uuid, field_id uuid, name text,
  value text, original_value text, confidence double, band text, status text,
  source text, reviewed_by uuid, reviewed_at timestamp,
  PRIMARY KEY ((document_id), field_id));

CREATE TABLE shares_by_document (document_id uuid, user_id uuid, level text, granted_by uuid,
  expires_at timestamp, PRIMARY KEY ((document_id), user_id));
CREATE TABLE shares_by_user (user_id uuid, document_id uuid, level text, granted_by uuid,
  expires_at timestamp, PRIMARY KEY ((user_id), document_id));

CREATE TABLE audit_by_document (document_id uuid, at timeuuid, tenant_id text, version_id uuid,
  actor uuid, actor_kind text, action text, detail text,
  PRIMARY KEY ((document_id), at)) WITH CLUSTERING ORDER BY (at DESC);
CREATE TABLE audit_by_tenant_day (tenant_id text, day date, at timeuuid, document_id uuid,
  actor uuid, action text, detail text,
  PRIMARY KEY ((tenant_id, day), at)) WITH CLUSTERING ORDER BY (at DESC);

CREATE TABLE idempotency_keys (tenant_id text, key text, request_hash text, response text,
  PRIMARY KEY ((tenant_id, key))) WITH default_time_to_live = 86400;   -- 24 h, INSERT ... IF NOT EXISTS

CREATE TABLE integration_clients_by_key (key_hash text PRIMARY KEY, client_id uuid, tenant_id text,
  name text, scopes set<text>, expires_at timestamp, revoked_at timestamp,
  read_limit int, write_limit int);
CREATE TABLE integration_tokens (token_hash text PRIMARY KEY, client_id uuid)
  WITH default_time_to_live = 900;                                    -- 15 min

CREATE TABLE api_rate (client_id uuid, kind text, window_start timestamp, hits counter,
  PRIMARY KEY ((client_id, kind, window_start)));
-- counters can't TTL: rows are tiny; purge with a daily job or use Redis INCR+EXPIRE

CREATE TABLE event_outbox_by_bucket (bucket text, id timeuuid, tenant_id text, document_id uuid,
  event_type text, payload text, PRIMARY KEY ((bucket), id));        -- bucket = yyyyMMddHHmm

CREATE TABLE event_delivery (event_id timeuuid, subscription_id uuid, tenant_id text,
  attempts int, next_attempt_at timestamp, locked_until timestamp, delivered_at timestamp,
  gave_up_at timestamp, last_status int, last_error text,
  PRIMARY KEY ((event_id), subscription_id));
CREATE TABLE event_deliveries_by_due (due_bucket text, next_attempt_at timestamp,
  event_id timeuuid, subscription_id uuid, PRIMARY KEY ((due_bucket), next_attempt_at, event_id, subscription_id));
-- claim: UPDATE event_delivery SET locked_until=? WHERE ... IF locked_until = <read value> (LWT)

CREATE TABLE doc_counts_by_tenant (tenant_id text, status text, n counter,
  PRIMARY KEY ((tenant_id), status));
```

## Rules for writers
- **Status change:** `UPDATE documents_by_id SET status=:to, updated_at=… WHERE id=:id IF status=:from AND deleted_at=null`. On success, batch the denormalised rows, the audit row and the outbox row.
- **Soft delete and restore:** set or clear deleted_at in every view table. **Purge:** set purged_at, null the content fields and delete the object. Versions and audit rows are kept.
- **Tenant isolation:** every API read checks `tenant_id` from the row against the caller before returning it.
- **Hot partitions:** an audit row per tenant per day, and the outbox per minute bucket, keep partitions under 100 MB.
- **Consistency:** LOCAL_QUORUM for reads and writes. LWT uses SERIAL / LOCAL_SERIAL.
