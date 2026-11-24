-- File hooks: indexes for the reads the file hooks added (final review, carried 6.4). Plain indexes,
-- no data change. On a large table, create them out of band with CONCURRENTLY first; IF NOT EXISTS
-- then makes this file a no-op.
-- The scan receipt check: a document's downloads for one version (file-result-receipts.ts).
CREATE INDEX IF NOT EXISTS document_events_version_action
  ON public.document_events (tenant_id, document_id, version_id, action);
-- The quarantine-rate count: an organisation's results of the last hour (file-result-alerts.ts).
CREATE INDEX IF NOT EXISTS document_events_tenant_action_time
  ON public.document_events (tenant_id, action, created_at);
-- The timeout sweep across organisations: only documents still in a step (file-hook-sweep.ts).
CREATE INDEX IF NOT EXISTS documents_waiting_steps
  ON public.documents (updated_at)
  WHERE pipeline_state IN ('uploading', 'scanning', 'reading') AND deleted_at IS NULL AND purged_at IS NULL;
