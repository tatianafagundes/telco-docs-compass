CREATE OR REPLACE FUNCTION public.search_document_ids(p jsonb, p_cap int DEFAULT 10000)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE ids uuid[];
BEGIN
  EXECUTE format('SELECT coalesce(array_agg(id), ''{}'') FROM (SELECT d.id FROM documents d WHERE %s ORDER BY d.updated_at DESC, d.id DESC LIMIT %s) s',
    public._doc_search_where(p), least(greatest(p_cap, 1), 10001)) INTO ids;
  RETURN ids;
END $$;
GRANT EXECUTE ON FUNCTION public.search_document_ids(jsonb, int) TO authenticated;