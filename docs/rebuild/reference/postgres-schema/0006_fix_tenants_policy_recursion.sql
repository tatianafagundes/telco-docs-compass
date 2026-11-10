CREATE OR REPLACE FUNCTION public.my_parent_tenant() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ select parent_tenant_id from public.tenants where id = public.user_tenant() $$;

CREATE OR REPLACE FUNCTION public.is_my_child_tenant(_tenant text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ select exists (select 1 from public.tenants where id = _tenant and parent_tenant_id = public.user_tenant()) $$;

REVOKE ALL ON FUNCTION public.my_parent_tenant() FROM public, anon;
REVOKE ALL ON FUNCTION public.is_my_child_tenant(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_parent_tenant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_child_tenant(text) TO authenticated;

DROP POLICY IF EXISTS tenants_read ON public.tenants;
CREATE POLICY tenants_read ON public.tenants FOR SELECT TO authenticated
  USING (id = public.user_tenant() OR id = public.my_parent_tenant()
         OR (parent_tenant_id = public.user_tenant() AND public.has_role('master_admin')));

DROP POLICY IF EXISTS specs_read ON public.document_specifications;
CREATE POLICY specs_read ON public.document_specifications FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant() OR tenant_id = public.my_parent_tenant());
DROP POLICY IF EXISTS retention_read ON public.retention_policies;
CREATE POLICY retention_read ON public.retention_policies FOR SELECT TO authenticated
  USING (tenant_id = public.user_tenant() OR tenant_id = public.my_parent_tenant());

DROP POLICY IF EXISTS specs_master_read ON public.document_specifications;
CREATE POLICY specs_master_read ON public.document_specifications FOR SELECT TO authenticated
  USING (public.has_role('master_admin') AND public.is_my_child_tenant(tenant_id));
DROP POLICY IF EXISTS retention_master_read ON public.retention_policies;
CREATE POLICY retention_master_read ON public.retention_policies FOR SELECT TO authenticated
  USING (public.has_role('master_admin') AND public.is_my_child_tenant(tenant_id));