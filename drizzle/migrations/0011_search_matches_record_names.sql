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
    w := w || format(' AND (d.search_tsv @@ websearch_to_tsquery(''simple'', %1$L) OR d.name ILIKE %2$L OR EXISTS (SELECT 1 FROM document_relations r2 JOIN business_entities be2 ON be2.id = r2.entity_id WHERE r2.document_id = d.id AND (r2.entity_id ILIKE %2$L OR (be2.display_name ILIKE %2$L AND %3$s))))',
      v_q, '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%',
      -- record names only match for records the caller may open, so shares never reveal them
      CASE WHEN v_adm THEN 'true' ELSE format('EXISTS (SELECT 1 FROM entity_access a2 WHERE a2.entity_id = be2.id AND a2.user_id = %L)', v_u) END);
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