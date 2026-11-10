CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, name || ' ' || coalesce(description, '') || ' ' || characteristic::text)) STORED;

CREATE INDEX IF NOT EXISTS documents_search_tsv ON public.documents USING gin (search_tsv);
CREATE INDEX IF NOT EXISTS documents_name_trgm ON public.documents USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_tenant_updated ON public.documents (tenant_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL AND purged_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_tenant_name ON public.documents (tenant_id, name, id) WHERE deleted_at IS NULL AND purged_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_tenant_type_updated ON public.documents (tenant_id, document_type, updated_at DESC, id DESC) WHERE deleted_at IS NULL AND purged_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_tenant_status_updated ON public.documents (tenant_id, status, updated_at DESC, id DESC) WHERE deleted_at IS NULL AND purged_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_tenant_hold ON public.documents (tenant_id, updated_at DESC) WHERE legal_hold AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS document_relations_entity ON public.document_relations (entity_id, document_id);
CREATE INDEX IF NOT EXISTS document_relations_entity_trgm ON public.document_relations USING gin (entity_id extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entity_access_user ON public.entity_access (user_id, entity_id);
CREATE INDEX IF NOT EXISTS extraction_fields_pending ON public.extraction_fields (document_id, version_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS access_exceptions_user ON public.document_access_exceptions (user_id, document_id);
CREATE INDEX IF NOT EXISTS business_entities_name_trgm ON public.business_entities USING gin (display_name extensions.gin_trgm_ops);

-- Builds the WHERE clause for one caller and one filter set. Visibility is set-based (same rule as
-- can_see_document) so it can use indexes instead of a per-row function. Values are inlined with %L.
CREATE OR REPLACE FUNCTION public._doc_search_where(p jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_t text := public.user_tenant();
  v_u uuid := auth.uid();
  v_adm boolean := public.has_role('tenant_admin');
  v_granted uuid[];
  v_q text := nullif(left(trim(coalesce(p->>'q', '')), 200), '');
  w text;
  v_arr text[];
BEGIN
  IF v_t IS NULL OR v_u IS NULL THEN RETURN 'false'; END IF;
  SELECT coalesce(array_agg(document_id), '{}') INTO v_granted FROM cross_tenant_grants
   WHERE to_tenant = v_t AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());

  w := format('d.deleted_at IS NULL AND d.purged_at IS NULL AND ((d.tenant_id = %L AND (%s)) OR d.id = ANY(%L::uuid[]))',
    v_t,
    CASE WHEN v_adm THEN 'true' ELSE format(
      'EXISTS (SELECT 1 FROM document_relations r JOIN entity_access a ON a.entity_id = r.entity_id WHERE r.document_id = d.id AND a.user_id = %1$L)
       OR EXISTS (SELECT 1 FROM document_access_exceptions x WHERE x.document_id = d.id AND x.user_id = %1$L AND (x.expires_at IS NULL OR x.expires_at > now()))', v_u) END,
    v_granted);

  IF v_q IS NOT NULL THEN
    w := w || format(' AND (d.search_tsv @@ websearch_to_tsquery(''simple'', %1$L) OR d.name ILIKE %2$L OR EXISTS (SELECT 1 FROM document_relations r2 WHERE r2.document_id = d.id AND r2.entity_id ILIKE %2$L))',
      v_q, '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%');
  END IF;
  v_arr := array(SELECT jsonb_array_elements_text(coalesce(p->'types', '[]')));
  IF cardinality(v_arr) > 0 THEN w := w || format(' AND d.document_type = ANY(%L::text[])', v_arr); END IF;
  v_arr := array(SELECT jsonb_array_elements_text(coalesce(p->'statuses', '[]')));
  IF cardinality(v_arr) > 0 THEN w := w || format(' AND d.status = ANY(%L::doc_status[])', v_arr); END IF;
  v_arr := array(SELECT jsonb_array_elements_text(coalesce(p->'sensitivity', '[]')));
  IF cardinality(v_arr) > 0 THEN w := w || format(' AND d.sensitivity = ANY(%L::sensitivity[])', v_arr); END IF;
  v_arr := array(SELECT jsonb_array_elements_text(coalesce(p->'entityTypes', '[]')));
  IF cardinality(v_arr) > 0 THEN
    w := w || format(' AND EXISTS (SELECT 1 FROM document_relations r3 JOIN business_entities be3 ON be3.id = r3.entity_id WHERE r3.document_id = d.id AND be3.referred_type = ANY(%L::text[]))', v_arr);
  END IF;
  IF nullif(p->>'entityId', '') IS NOT NULL THEN
    w := w || format(' AND EXISTS (SELECT 1 FROM document_relations r4 WHERE r4.document_id = d.id AND r4.entity_id = %L)', p->>'entityId');
  END IF;
  IF (p->>'hold')::boolean IS TRUE THEN w := w || ' AND d.legal_hold'; END IF;
  IF (p->>'review')::boolean IS TRUE THEN
    w := w || ' AND d.status IN (''draft'', ''in_review'') AND EXISTS (SELECT 1 FROM extraction_fields f WHERE f.document_id = d.id AND f.version_id = d.current_version_id AND f.status = ''pending'')';
  END IF;
  IF nullif(p->>'changedAfter', '') IS NOT NULL THEN w := w || format(' AND d.updated_at >= %L::timestamptz', p->>'changedAfter'); END IF;
  IF nullif(p->>'expiringBefore', '') IS NOT NULL THEN
    w := w || format(' AND d.expiry_date IS NOT NULL AND d.expiry_date >= current_date AND d.expiry_date <= %L::date', p->>'expiringBefore');
  END IF;
  RETURN w;
END $$;
REVOKE EXECUTE ON FUNCTION public._doc_search_where(jsonb) FROM PUBLIC, anon, authenticated;

-- One page of results, keyset paging. p.sort: 'updated' (default) | 'name' | 'expiry'. p.cursor: {v, id}.
CREATE OR REPLACE FUNCTION public.search_documents(p jsonb)
RETURNS TABLE(id uuid, name text, document_type text, status doc_status, sensitivity sensitivity, legal_hold boolean,
              updated_at timestamptz, expiry_date date, pending int, entity_id text, entity_name text, entity_type text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  w text := public._doc_search_where(p);
  v_u uuid := auth.uid();
  v_adm boolean := public.has_role('tenant_admin');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 101);
  v_sort text := coalesce(p->>'sort', 'updated');
  v_cv text := p->'cursor'->>'v';
  v_cid uuid := nullif(p->'cursor'->>'id', '')::uuid;
  v_order text;
BEGIN
  IF v_sort = 'name' THEN
    v_order := 'd.name ASC, d.id ASC';
    IF v_cid IS NOT NULL THEN w := w || format(' AND (d.name, d.id) > (%L, %L::uuid)', v_cv, v_cid); END IF;
  ELSIF v_sort = 'expiry' THEN
    v_order := 'd.expiry_date ASC NULLS LAST, d.id ASC';
    w := w || ' AND d.expiry_date IS NOT NULL';
    IF v_cid IS NOT NULL THEN w := w || format(' AND (d.expiry_date, d.id) > (%L::date, %L::uuid)', v_cv, v_cid); END IF;
  ELSE
    v_order := 'd.updated_at DESC, d.id DESC';
    IF v_cid IS NOT NULL THEN w := w || format(' AND (d.updated_at, d.id) < (%L::timestamptz, %L::uuid)', v_cv, v_cid); END IF;
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT d.id, d.name, d.document_type, d.status, d.sensitivity, d.legal_hold, d.updated_at, d.expiry_date,
            (SELECT count(*) FROM extraction_fields f WHERE f.document_id = d.id AND f.version_id = d.current_version_id AND f.status = ''pending'')::int,
            rel.entity_id,
            CASE WHEN %s THEN be.display_name END,
            be.referred_type
       FROM documents d
       LEFT JOIN LATERAL (SELECT r.entity_id FROM document_relations r WHERE r.document_id = d.id ORDER BY r.attached_on LIMIT 1) rel ON true
       LEFT JOIN business_entities be ON be.id = rel.entity_id AND be.tenant_id = d.tenant_id
      WHERE %s ORDER BY %s LIMIT %s',
    CASE WHEN v_adm THEN 'true' ELSE format('EXISTS (SELECT 1 FROM entity_access a WHERE a.entity_id = be.id AND a.user_id = %L)', v_u) END,
    w, v_order, v_limit);
END $$;
GRANT EXECUTE ON FUNCTION public.search_documents(jsonb) TO authenticated;

-- Count capped at 10,001 so big results stay cheap ("10,000+").
CREATE OR REPLACE FUNCTION public.count_documents(p jsonb)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE n int;
BEGIN
  EXECUTE format('SELECT count(*)::int FROM (SELECT 1 FROM documents d WHERE %s LIMIT 10001) s', public._doc_search_where(p)) INTO n;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.count_documents(jsonb) TO authenticated;

-- Facet counts under the current filters (each facet ignores its own selection).
CREATE OR REPLACE FUNCTION public.facet_documents(p jsonb)
RETURNS TABLE(facet text, value text, n bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN QUERY EXECUTE format('SELECT ''types''::text, d.document_type::text, count(*) FROM documents d WHERE %s GROUP BY 2', public._doc_search_where(p - 'types'));
  RETURN QUERY EXECUTE format('SELECT ''statuses''::text, d.status::text, count(*) FROM documents d WHERE %s GROUP BY 2', public._doc_search_where(p - 'statuses'));
  RETURN QUERY EXECUTE format('SELECT ''sensitivity''::text, d.sensitivity::text, count(*) FROM documents d WHERE %s GROUP BY 2', public._doc_search_where(p - 'sensitivity'));
  RETURN QUERY EXECUTE format('SELECT ''hold''::text, ''true''::text, count(*) FROM documents d WHERE %s AND d.legal_hold', public._doc_search_where(p - 'hold'));
END $$;
GRANT EXECUTE ON FUNCTION public.facet_documents(jsonb) TO authenticated;

-- Saved views: personal, or shared with the organisation by an admin.
CREATE TABLE public.saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  owner uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  filters jsonb NOT NULL DEFAULT '{}',
  shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.saved_views TO authenticated;
GRANT ALL ON public.saved_views TO service_role;
ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_views_read ON public.saved_views FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant() AND (owner = auth.uid() OR shared));

-- Bulk jobs: ids are resolved as the requesting person at creation, then processed in batches.
CREATE TABLE public.bulk_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  created_by uuid NOT NULL,
  actor_role app_role NOT NULL,
  action text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  doc_ids uuid[] NOT NULL,
  total int NOT NULL,
  done int NOT NULL DEFAULT 0,
  changed int NOT NULL DEFAULT 0,
  skipped jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.bulk_jobs TO authenticated;
GRANT ALL ON public.bulk_jobs TO service_role;
ALTER TABLE public.bulk_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY bulk_jobs_own ON public.bulk_jobs FOR SELECT TO authenticated
  USING (created_by = auth.uid());
CREATE INDEX bulk_jobs_pending ON public.bulk_jobs (created_at) WHERE status IN ('queued', 'running');