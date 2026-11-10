CREATE TABLE public.integration_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  system_kind text NOT NULL DEFAULT 'other',
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{read}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
GRANT SELECT ON public.integration_clients TO authenticated;
GRANT ALL ON public.integration_clients TO service_role;
ALTER TABLE public.integration_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see their tenant systems" ON public.integration_clients
  FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant() AND (public.has_role('tenant_admin') OR public.has_role('master_admin')));

CREATE TABLE public.event_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.integration_clients(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  callback text NOT NULL,
  query text,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.event_subscriptions TO service_role;
ALTER TABLE public.event_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.event_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  event_type text NOT NULL,
  document_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);
GRANT ALL ON public.event_outbox TO service_role;
ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY;
CREATE INDEX event_outbox_pending ON public.event_outbox (created_at) WHERE delivered_at IS NULL;

CREATE OR REPLACE FUNCTION public.documents_to_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentCreateEvent', NEW.id, jsonb_build_object('lifecycleState', NEW.status));
  ELSIF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    INSERT INTO event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentDeleteEvent', NEW.id, '{}');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentStateChangeEvent', NEW.id, jsonb_build_object('lifecycleState', NEW.status, 'previous', OLD.status));
  ELSIF NEW.legal_hold IS DISTINCT FROM OLD.legal_hold OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id OR NEW.characteristic IS DISTINCT FROM OLD.characteristic THEN
    INSERT INTO event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentAttributeValueChangeEvent', NEW.id, '{}');
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.documents_to_outbox() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER documents_outbox AFTER INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_to_outbox();