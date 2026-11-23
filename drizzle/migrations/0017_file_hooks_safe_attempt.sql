-- Follow-up to 0016 (review): a malformed pipeline_detail.attempt no longer aborts the document update
-- that fires the file-event trigger; it counts as 0.
CREATE OR REPLACE FUNCTION public.documents_file_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
