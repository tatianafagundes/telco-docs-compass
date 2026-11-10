# Design

The design is fully described in the handbook. Kiro should treat these files as the design document:
- Architecture and ADRs: `docs/rebuild/09-target-architecture.md`
- Data: `10-data-mapping-cassandra.md`, `11-opensearch-index.md`
- Identity: `12-keycloak.md`
- Security: `04-security-and-tenancy.md`
- APIs: `06-api/`, `contracts/`
- UI: `05-screens/`, `13-angular-frontend.md`
- Integrations and events: `07-integrations.md`
- Search: `08-search-at-scale.md`
- Non-functional: `14-non-functional.md`
- Reference implementation of every rule: `reference/rules/`, with tests in `reference/rule-tests/`

## Known open decisions
1. Should the TMF API approve path enforce four-eyes per system? Recommendation: yes (see 04).
2. Rate counters: Cassandra counters or Redis.
3. Event transport: a scheduled HTTP worker (as today) or Kafka.
4. A real malware scan and extraction engine to replace the simulated pipeline.
