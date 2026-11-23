# 18 — Tenancy, file storage and data protection (DXP, CPR pattern)
Decision (2026-11-24): the DXP rebuild follows the same pattern as the Organization Management service in
CPR. This chapter replaces the shared keyspace and shared index of `10-data-mapping-cassandra.md` and
`11-opensearch-index.md` where they differ.

## What the CPR pattern is (sources)
| Fact | Source |
| --- | --- |
| Organization Management (`eric-dxp-organization-management`) and Party Role Management (`eric-dxp-partyrole-management`) are CRUD services persisted in WCDB (Cassandra). | Develop ECM EOC CPQ Services and Modules (eTeamSpace, SABSS) |
| A dedicated Search Engine (`eric-data-search-engine-index`) indexes CPR entities stored in WCDB. It is an index, not the store. | same; Cloud Reference Deployment Guidelines (CALStore) |
| Tenants are isolated logically: one Cassandra keyspace per tenant holds that tenant's tables; only the master tenant can access every keyspace. | DXP Product Overview (CALStore) |
| Search indexes are created per tenant; reindexing can run for one tenant or for all. | DXP Product Overview (CALStore) |
| In geo-redundant sites Cassandra replicates the data; indexes are synchronised through Kafka (`eric-data-message-bus-kf-cpr`) and the Reindex Management service (`eric-dxp-reindex-management`); every indexing service exposes a reindex REST endpoint. | Multisite Setup and Configuration Guide (CPI); Develop ECM EOC CPQ Services and Modules |
| CPR configuration is kept in CM Mediator and read through CM Proxy (`ericsson-dxp-cmproxy`). | Cloud Reference Deployment Guidelines |
| Files: ADP Object Storage MN (`eric-data-object-storage-mn`, MinIO, S3 API) with encryption through the Key Management service (`eric-sec-key-management`, Vault). Commercial licence: confirm with the PO. | ADP Marketplace; Object Storage MN user guide (CALStore) |

Not found in the sources, so to confirm with the CPR team: the exact keyspace naming, the table design,
how a new tenant's keyspace is created (operator, job or service), the Kafka event schema, and any
CPR-specific GDPR or audit behaviour.

## Decisions (TD = tenancy decision)
| Id | Decision | Why |
| --- | --- | --- |
| TD-01 | One Cassandra keyspace per tenant, `erad_<tenant>`, with every table of chapter 10 inside it. `tenant_id` stays on each row as a second check. | Same as CPR. Erasing or moving a tenant is one keyspace. |
| TD-02 | One shared keyspace, `erad_platform`, only for what must be found before the tenant is known or across tenants: the tenant registry (id, parent, region, keyspace, index, bucket, key id), connected-system keys by hash, cross-tenant grants, and the rate-limit counters. No document data. | A system key arrives without a tenant; a grant links two tenants. |
| TD-03 | One search index per tenant, `erad-documents-<tenant>`, behind an alias. The indexer is per tenant and exposes the reindex REST endpoint like the CPR services. | Same as CPR. Search can never cross tenants by a missing filter. |
| TD-04 | Geo-redundancy as CPR: Cassandra replicates the keyspaces; the index is rebuilt or synchronised through the CPR Kafka and Reindex Management path. | No second mechanism to operate. |
| TD-05 | Files go to the customer's own store through a storage port (see "Pluggable file storage"). Per tenant: one bucket or container, object key `<document>/<version>`, objects never overwritten, download only through short-lived links issued after the access check (ADR-12). | Each customer brings its store; bucket per tenant mirrors keyspace per tenant. |
| TD-06 | Legal hold uses the store's object lock when the adapter reports it. When it does not, the service still refuses deletes and the screen says the hold is not enforced by the store. | Not every customer store has WORM. |
| TD-07 | The group (master) tenant may technically read every keyspace, as in DXP, but the application keeps BR rules: the group administrator reads counts and settings only, never documents (ADR-08). A test guards that the master module has no document DTOs. | The platform allows more than the product does. |
| TD-08 | Tenant configuration (inheritance, locks, floors) stays in the application (`tenant` module); deployment-level settings go to CM Mediator, read through CM Proxy like CPR. | Business configuration changes per tenant at runtime; CM is deployment configuration. |

| TD-09 | Both topologies are supported: one DXP per country, or one multi-region DXP for several countries. The customer chooses at deployment. Single region is the case where every tenant has the same region. | Decided 2026-11-24: the customer chooses. |
| TD-10 | Encryption keys go through a key port: the default adapter is the ADP Key Management service (Vault); a customer adapter can point to the customer's KMS or HSM (BYOK). Keycloak carries the tenant in the token, which selects the key; Keycloak does not hold data keys. | Keycloak is identity, not key management. |

## Pluggable file storage
The customer runs its own store, so the service never talks to one product. In DXP terms each adapter is a
Connector (southbound to the customer's system), and the document microservice calls a single storage port.

Storage port (one per tenant, chosen in the tenant registry as a storage profile):
| Operation | Meaning |
| --- | --- |
| `capabilities()` | What the store can do: object lock (retention, legal hold), server-side encryption with a customer key, versioning, pre-signed links, regions. The service adapts to it. |
| `put(tenant, key, stream, sha256)` | Store a new object; fails if the key exists. Returns the store's checksum, compared with ours. |
| `head(tenant, key)` | Size and checksum, to confirm an upload arrived (closes the TMF667 upload gap). |
| `downloadLink(tenant, key, seconds)` | A short-lived link, or a stream through the service when the store has no pre-signed links. |
| `uploadLink(tenant, key, seconds, sha256)` | For direct upload from the browser or a connected system, when supported. |
| `setHold(tenant, key, on)` / `setRetention(tenant, key, until)` | Object lock when supported; otherwise not supported, recorded. |
| `delete(tenant, key)` | Purge. Refused by the service before the call when a hold or keep-until date applies. |

Adapters to build first: S3-compatible (covers ADP Object Storage MN, AWS S3, Ceph, NetApp StorageGRID and
other MinIO or S3 stores) and Azure Blob. Others (for example a customer document management system over
CMIS) as Connectors when a customer needs them.

Hooks (events the service emits; the customer plugs its own systems in):
| Hook | When | Typical use |
| --- | --- | --- |
| `file.stored` | after `put` and checksum match | the customer's antivirus scan; the reply sets the file to clean or quarantined |
| `file.ready-to-read` | after the scan is clean | OCR or extraction (AI) of details |
| `file.held` / `file.released` | legal hold changes | the customer's records or legal system |
| `file.purged` | after permanent deletion | the customer's own copies and backups |
Hooks go through the outbox and the ADP Message Bus (Kafka), with the same delivery rules as the TMF events
(retries, dead letter, no file content in the event).

## Where data lives (residency)
- Each tenant has a region in the tenant registry. Its keyspace is replicated only to that region's data
  centres, its index lives on that region's search cluster, and its bucket on that region's object store.
  Writes check that the request reaches the tenant's region.
- One DXP per country needs nothing more. A multi-region DXP needs per-keyspace replication settings that
  name only the allowed data centres. **To confirm with the platform team:** whether CPR keyspaces are
  created with per-tenant replication settings today.

## Encryption and keys
- Cassandra encryption at rest is per cluster or node, one key for all tenants. Moving to Cassandra does
  **not** give per-tenant keys by itself.
- Files: SSE-KMS with one key per tenant bucket in the Key Management service.
- Cassandra: when a tenant needs its own key, encrypt the sensitive columns (extracted details,
  description, hold reason) in the service with a data key per tenant (envelope encryption); the index then
  holds no plain text of those fields.
- Deleting a tenant's keys makes its data unreadable, including in backups (crypto-shredding).

## Personal data (LGPD / GDPR)
| Id | Rule |
| --- | --- |
| DP-01 | Personal data map: file content, extracted details, description, hold reason, names of people who acted, the index, logs and backups. Logs carry no personal data (already a rule in the prototype). |
| DP-02 | A document stores the party it is about (the customer or party behind its record, TMF632/TMF669 id from CPR), indexed, so a subject access request finds every document of a person in that tenant. |
| DP-03 | Subject access: an export job per tenant lists the person's documents, versions and extracted details, written to the tenant bucket, delivered by a short-lived link, and audited. |
| DP-04 | Erasure: refused while a legal hold or a keep-until date applies (legal obligation), and the refusal is recorded with its reason. Otherwise it purges content, details and index entries (the existing purge) and leaves the tombstone in the history. |
| DP-05 | The audit keeps the id of the person who acted, not the name; the name is resolved on read. An erased person reads as "Removed person". |
| DP-06 | Tenant offboarding: drop the keyspace, the index and the bucket, then destroy the tenant keys; the registry keeps a tombstone with the date. |

## Audit export
| Id | Rule |
| --- | --- |
| AE-01 | Filters: tenant, date range, document, person who acted, action. Formats CSV and JSON. |
| AE-02 | Runs as a background job; the file goes to the tenant bucket; the download link is pre-signed and short-lived. |
| AE-03 | Every export has a manifest with a hash per row chained to the previous one, and the hash of the file, so legal teams can show it was not changed. The audit table is append-only (ADR-10). |
| AE-04 | The export itself is an audit event: who, when, which filter, how many rows. |
| AE-05 | Only a role made for it (auditor or compliance) may export; a manager may not. This role is new in Keycloak (chapter 12). |
| AE-06 | Optional: stream audit events to the customer's SIEM through the ADP Message Bus (Kafka). |

## Answered (2026-11-24)
- Topology: the customer chooses (TD-09), so residency is built in from the start.
- BYOK: wanted; through the key port (TD-10). Keycloak selects the tenant, the customer's KMS holds the key.
- File store: the customer brings its own, so storage is a port with adapters and hooks (TD-05, TD-06).

## Open questions
1. Keyspace naming, keyspace creation and the reindex contract: take them from the CPR Organization Management implementation.
2. Which stores the first customers run (S3-compatible, Azure Blob, something else), and whether they have object lock.
3. Which KMS or HSM a BYOK customer uses, and whether DXP already has a key-provider integration to reuse.
