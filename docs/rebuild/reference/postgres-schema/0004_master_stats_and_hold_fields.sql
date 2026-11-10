ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS hold_reference text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS hold_since timestamptz;

-- Counts only for a child tenant (or own tenant for its admin). Never returns names or content.
CREATE OR REPLACE FUNCTION public.master_document_stats(p_tenant text)
RETURNS TABLE(document_type text, status doc_status, pipeline_state pipeline_state, legal_hold boolean, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  select d.document_type, d.status, d.pipeline_state, d.legal_hold, count(*)
  from public.documents d
  where d.tenant_id = p_tenant and d.deleted_at is null
    and (
      (public.has_role('master_admin') and exists (select 1 from public.tenants x where x.id = p_tenant and x.parent_tenant_id = public.user_tenant()))
      or (public.has_role('tenant_admin') and p_tenant = public.user_tenant())
    )
  group by 1,2,3,4
$$;
REVOKE ALL ON FUNCTION public.master_document_stats(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.master_document_stats(text) TO authenticated;

-- Group admins may read the settings (not documents) of their child tenants.
CREATE POLICY specs_master_read ON public.document_specifications FOR SELECT TO authenticated
  USING (public.has_role('master_admin') AND tenant_id IN (select id from public.tenants where parent_tenant_id = public.user_tenant()));
CREATE POLICY retention_master_read ON public.retention_policies FOR SELECT TO authenticated
  USING (public.has_role('master_admin') AND tenant_id IN (select id from public.tenants where parent_tenant_id = public.user_tenant()));