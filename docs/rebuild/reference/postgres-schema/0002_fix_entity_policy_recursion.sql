CREATE OR REPLACE FUNCTION public.entity_in_my_tenant(_entity_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.business_entities e WHERE e.id = _entity_id AND e.tenant_id = public.user_tenant())
$$;
REVOKE ALL ON FUNCTION public.entity_in_my_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entity_in_my_tenant(text) TO authenticated;
DROP POLICY entity_access_self ON public.entity_access;
CREATE POLICY entity_access_self ON public.entity_access FOR SELECT TO authenticated
USING (user_id = auth.uid() OR (public.has_role('tenant_admin'::public.app_role) AND public.entity_in_my_tenant(entity_id)));