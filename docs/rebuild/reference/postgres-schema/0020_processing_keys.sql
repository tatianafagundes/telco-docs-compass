-- File hooks (D3, D4): a key for the organisation's own antivirus (`scan`) or reader (`extract`) has
-- that one scope, and an organisation has at most one such key that is not disconnected. The
-- application checks both; the database makes two creations at once unable to both succeed.
ALTER TABLE public.integration_clients
  ADD CONSTRAINT integration_clients_processing_scope_alone
  CHECK (NOT (scopes && ARRAY['scan', 'extract']::text[]) OR pg_catalog.cardinality(scopes) = 1);
CREATE UNIQUE INDEX IF NOT EXISTS integration_clients_one_processing_key
  ON public.integration_clients (tenant_id, (scopes[1]))
  WHERE revoked_at IS NULL AND pg_catalog.cardinality(scopes) = 1 AND scopes[1] IN ('scan', 'extract');
-- The organisation switch (D1): an object whose scan and read, when present, are true or false. A bad
-- value is refused here instead of reading as "off" (built-in simulated check).
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_external_processing_shape
  CHECK (
    pg_catalog.jsonb_typeof(external_processing) = 'object'
    AND (NOT external_processing ? 'scan' OR pg_catalog.jsonb_typeof(external_processing->'scan') = 'boolean')
    AND (NOT external_processing ? 'read' OR pg_catalog.jsonb_typeof(external_processing->'read') = 'boolean')
  );
-- Changing the switch: the row is locked, only the named steps change (two changes at once never undo
-- each other), and each change is recorded in the same transaction. Called by the server only.
CREATE OR REPLACE FUNCTION public.set_external_processing(p_tenant text, p_actor uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  before jsonb;
  after jsonb;
  k text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'external_processing patch must be an object';
  END IF;
  SELECT external_processing INTO before FROM public.tenants WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown tenant';
  END IF;
  after := before;
  FOREACH k IN ARRAY ARRAY['scan', 'read'] LOOP
    IF p_patch ? k THEN
      IF pg_catalog.jsonb_typeof(p_patch->k) IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'external_processing.% must be true or false', k;
      END IF;
      after := pg_catalog.jsonb_set(after, ARRAY[k], p_patch->k);
    END IF;
  END LOOP;
  IF after IS DISTINCT FROM before THEN
    UPDATE public.tenants SET external_processing = after WHERE id = p_tenant;
    FOREACH k IN ARRAY ARRAY['scan', 'read'] LOOP
      IF COALESCE((before->>k)::boolean, false) IS DISTINCT FROM COALESCE((after->>k)::boolean, false) THEN
        INSERT INTO public.document_events(tenant_id, document_id, actor, action, detail)
        VALUES (p_tenant, NULL, p_actor, 'configChange',
          'externalProcessing.' || k || ': '
          || CASE WHEN COALESCE((before->>k)::boolean, false) THEN 'on' ELSE 'off' END || ' to '
          || CASE WHEN COALESCE((after->>k)::boolean, false) THEN 'on' ELSE 'off' END);
      END IF;
    END LOOP;
  END IF;
  RETURN after;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_external_processing(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_external_processing(text, uuid, jsonb) TO service_role;
