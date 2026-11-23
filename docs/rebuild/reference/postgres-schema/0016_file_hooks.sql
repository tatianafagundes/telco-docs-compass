-- File hooks (spec .kiro/specs/file-hooks): the organisation switch for external processing (D1) and
-- file events written atomically with the change that causes them (D2).
-- Events carry ids, hashes and flags only; never file content, detail values, names or hold reasons.

-- D1: { "scan": true|false, "read": true|false }; empty means simulated for both steps.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS external_processing jsonb NOT NULL DEFAULT '{}'::jsonb;

-- D2: file events, in their own trigger so the existing if/elsif chain does not hide them.
CREATE OR REPLACE FUNCTION public.documents_file_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
  attempt int := COALESCE((NEW.pipeline_detail->>'attempt')::int, 0);
BEGIN
  IF NEW.pipeline_state = 'scanning' AND OLD.pipeline_state IS DISTINCT FROM 'scanning' THEN
    SELECT id, content_hash, size_bytes, mime_type INTO v
      FROM document_versions WHERE id = NEW.current_version_id;
    IF FOUND THEN
      INSERT INTO event_outbox(tenant_id, event_type, document_id, payload)
      VALUES (NEW.tenant_id, 'DocumentFileStoredEvent', NEW.id, jsonb_build_object(
        'versionId', v.id, 'contentHash', v.content_hash, 'sizeBytes', v.size_bytes,
        'mediaType', v.mime_type, 'attempt', attempt));
    END IF;
  ELSIF NEW.pipeline_state = 'reading' AND OLD.pipeline_state IS DISTINCT FROM 'reading' THEN
    INSERT INTO event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentFileReadyToReadEvent', NEW.id, jsonb_build_object(
      'versionId', NEW.current_version_id, 'attempt', attempt));
  END IF;
  IF NEW.purged_at IS NOT NULL AND OLD.purged_at IS NULL THEN
    INSERT INTO event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentFilePurgedEvent', NEW.id, jsonb_build_object(
      'versionIds', COALESCE((SELECT jsonb_agg(id) FROM document_versions WHERE document_id = NEW.id), '[]'::jsonb)));
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.documents_file_events() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS documents_file_events ON public.documents;
CREATE TRIGGER documents_file_events AFTER UPDATE OF pipeline_state, purged_at ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_file_events();

-- D6: the existing change event says whether the document is now on hold (a boolean, never the reason).
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
  ELSIF NEW.legal_hold IS DISTINCT FROM OLD.legal_hold THEN
    INSERT INTO event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentAttributeValueChangeEvent', NEW.id, jsonb_build_object('legalHold', NEW.legal_hold));
  ELSIF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id OR NEW.characteristic IS DISTINCT FROM OLD.characteristic THEN
    INSERT INTO event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentAttributeValueChangeEvent', NEW.id, '{}');
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.documents_to_outbox() FROM PUBLIC, anon, authenticated;
