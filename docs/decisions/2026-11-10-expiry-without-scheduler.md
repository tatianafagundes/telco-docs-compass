# Expiry without a scheduler (superseded)
Superseded on 2026-11-17: expiry runs in the scheduled job (`maintenance.ts`), in batches, for every tenant. Opening a list keeps a safety net (`expiry-fallback.ts`): it expires the reader's own tenant's due documents at most once a minute per tenant, and never fails the read. So a preview without a scheduler still expires documents.

Original note (2026-11-10): there was no cron in the prototype. Documents past `expiry_date` moved to Expired whenever documents were listed (`find`).
