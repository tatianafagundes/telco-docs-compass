-- File hooks (D3, D4): a key for the organisation's own antivirus (`scan`) or reader (`extract`) has
-- that one scope, and an organisation has at most one such key that is not disconnected. The
-- application checks both; the database makes two creations at once unable to both succeed.
ALTER TABLE public.integration_clients
  ADD CONSTRAINT integration_clients_processing_scope_alone
  CHECK (NOT (scopes && ARRAY['scan', 'extract']::text[]) OR pg_catalog.cardinality(scopes) = 1);
CREATE UNIQUE INDEX IF NOT EXISTS integration_clients_one_processing_key
  ON public.integration_clients (tenant_id, (scopes[1]))
  WHERE revoked_at IS NULL AND pg_catalog.cardinality(scopes) = 1 AND scopes[1] IN ('scan', 'extract');
