-- Follow-up to 0016/0017 (security review): definer functions use an empty search_path with qualified
-- names; the version read for an event must belong to the same document and tenant; a hold change no
-- longer hides a version or characteristic change made in the same update.
CREATE OR REPLACE FUNCTION public.documents_file_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v record;
  attempt int := 0;
BEGIN
  -- A malformed attempt must never block the update itself: it counts as 0.
  IF (NEW.pipeline_detail->>'attempt') ~ '^[0-9]{1,9}$' THEN
    attempt := (NEW.pipeline_detail->>'attempt')::int;
  END IF;
  IF NEW.pipeline_state = 'scanning' AND OLD.pipeline_state IS DISTINCT FROM 'scanning' THEN
    SELECT id, content_hash, size_bytes, mime_type INTO v
      FROM public.document_versions
      WHERE id = NEW.current_version_id AND document_id = NEW.id AND tenant_id = NEW.tenant_id;
    IF FOUND THEN
      INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
      VALUES (NEW.tenant_id, 'DocumentFileStoredEvent', NEW.id, pg_catalog.jsonb_build_object(
        'versionId', v.id, 'contentHash', v.content_hash, 'sizeBytes', v.size_bytes,
        'mediaType', v.mime_type, 'attempt', attempt));
    END IF;
  ELSIF NEW.pipeline_state = 'reading' AND OLD.pipeline_state IS DISTINCT FROM 'reading' THEN
    INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentFileReadyToReadEvent', NEW.id, pg_catalog.jsonb_build_object(
      'versionId', NEW.current_version_id, 'attempt', attempt));
  END IF;
  IF NEW.purged_at IS NOT NULL AND OLD.purged_at IS NULL THEN
    INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentFilePurgedEvent', NEW.id, pg_catalog.jsonb_build_object(
      'versionIds', COALESCE((SELECT pg_catalog.jsonb_agg(id) FROM public.document_versions
        WHERE document_id = NEW.id AND tenant_id = NEW.tenant_id), '[]'::jsonb)));
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.documents_file_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.documents_to_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentCreateEvent', NEW.id, pg_catalog.jsonb_build_object('lifecycleState', NEW.status));
  ELSIF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentDeleteEvent', NEW.id, '{}');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentStateChangeEvent', NEW.id, pg_catalog.jsonb_build_object('lifecycleState', NEW.status, 'previous', OLD.status));
  ELSE
    -- The hold change names only the attribute (receivers fetch the document for its value).
    IF NEW.legal_hold IS DISTINCT FROM OLD.legal_hold THEN
      INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
      VALUES (NEW.tenant_id, 'DocumentAttributeValueChangeEvent', NEW.id, pg_catalog.jsonb_build_object('changed', 'legalHold'));
    END IF;
    IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id OR NEW.characteristic IS DISTINCT FROM OLD.characteristic THEN
      INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
      VALUES (NEW.tenant_id, 'DocumentAttributeValueChangeEvent', NEW.id, '{}');
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.documents_to_outbox() FROM PUBLIC, anon, authenticated;
