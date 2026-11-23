-- Follow-up to 0018 (QA review): a hold change made together with a status change or a deletion is
-- still named; the ReadyToRead event names only a version of the same document and tenant; the
-- attempt in file events is read as a JSON whole number, as the application reads it.
CREATE OR REPLACE FUNCTION public.documents_file_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v record;
  attempt int := 0;
  n numeric;
BEGIN
  -- The attempt is a JSON whole number from 0 to 999999999, read the way the application reads it
  -- (3.0 is 3; text such as "03" is not a number). Anything else counts as 0 and never blocks the update.
  IF pg_catalog.jsonb_typeof(NEW.pipeline_detail->'attempt') = 'number' THEN
    n := (NEW.pipeline_detail->>'attempt')::numeric;
    IF n >= 0 AND n <= 999999999 AND n = pg_catalog.trunc(n) THEN
      attempt := n::int;
    END IF;
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
    -- Like Stored: only a version of this document and tenant is ever named.
    SELECT id INTO v
      FROM public.document_versions
      WHERE id = NEW.current_version_id AND document_id = NEW.id AND tenant_id = NEW.tenant_id;
    IF FOUND THEN
      INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
      VALUES (NEW.tenant_id, 'DocumentFileReadyToReadEvent', NEW.id, pg_catalog.jsonb_build_object(
        'versionId', v.id, 'attempt', attempt));
    END IF;
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
    IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id OR NEW.characteristic IS DISTINCT FROM OLD.characteristic THEN
      INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
      VALUES (NEW.tenant_id, 'DocumentAttributeValueChangeEvent', NEW.id, '{}');
    END IF;
  END IF;
  -- A hold change is named whatever else changed in the same update (only the attribute: receivers
  -- fetch the document for its value).
  IF TG_OP = 'UPDATE' AND NEW.legal_hold IS DISTINCT FROM OLD.legal_hold THEN
    INSERT INTO public.event_outbox(tenant_id, event_type, document_id, payload)
    VALUES (NEW.tenant_id, 'DocumentAttributeValueChangeEvent', NEW.id, pg_catalog.jsonb_build_object('changed', 'legalHold'));
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.documents_to_outbox() FROM PUBLIC, anon, authenticated;
