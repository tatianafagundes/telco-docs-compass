---
inclusion: always
---
# Structure

```text
backend/
  src/main/java/com/erad/{shared,identity,tenant,access,document,review,pipeline,retention,search,integration,events}/
    api/        controllers + DTOs (no repositories here)
    app/        application services: CallerContext → load → canSee/role/*Rules → batch write + audit + outbox
    domain/     *Rules (pure), value objects, enums
    infra/      Cassandra repositories, OpenSearch, object store, HTTP clients
  src/main/resources/cql/   schema migrations (cassandra-migration)
  src/test/java/...          mirrors main; rules tests ported from reference/rule-tests
frontend/
  src/app/core/      auth, http interceptors, error mapping, tokens
  src/app/erad/      design-system components
  src/app/features/  documents, records, review, shared, holds, admin
parity/              Given/When/Then scenarios + ported e2e scripts
infra/               docker-compose (Cassandra 5, OpenSearch, Keycloak, MinIO), realm import
```
