---
inclusion: always
---
# Invariants: never change these without an explicit decision from the product owner

1. **Tenant isolation.** A person or system sees only their own tenant's data, plus documents explicitly granted to their tenant. A Norway user must never receive Sweden record or document identifiers in any response (L1).
2. **The group sees counts only.** master_admin gets aggregates and settings, never document rows, names or records.
3. **One visibility rule.** `canSee` (04, BR-090) is the single rule. Search uses the same rule as an OpenSearch filter, and results are re-checked.
4. **Shared-only access never leaks record details** (BR-093), and removing a share takes effect immediately (BR-094).
5. **Four-eyes.** The person who added a document cannot approve it (BR-022).
6. **No auto-acceptance.** Approval waits until a person has confirmed every required detail (BR-020, BR-023).
7. **The status path is forward-only** (BR-010). Send-back is the only way back. Frozen statuses keep their details.
8. **Legal hold beats retention,** and retention beats deletion. Permanent deletion is admin-only and leaves a tombstone (BR-050–053).
9. **Versions and audit are append-only.** Audit is written by the operation itself. Clients may add only view and download events. Detail values never go into audit, logs or events.
10. **Events carry references only,** are signed, are delivered per subscriber, and are never duplicated across subscribers or passes (BR-120–127).
11. **Per-system rate limits** are isolated per system (BR-115).
12. **Unavailable actions stay focusable** (`aria-disabled`) and show their reason. Copy is the exact English from the reference.
