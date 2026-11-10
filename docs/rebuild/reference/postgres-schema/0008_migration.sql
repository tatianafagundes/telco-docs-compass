CREATE OR REPLACE FUNCTION public.effective_specifications(p_tenant text DEFAULT user_tenant())
 RETURNS TABLE(id text, tenant_id text, code text, name text, version text, lifecycle_status text, locked boolean, definition jsonb, defined_in text, overridden boolean, overridden_fields text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with t as (select id, parent_tenant_id from public.tenants where id = p_tenant),
  master as (select s.* from public.document_specifications s, t where s.tenant_id = t.parent_tenant_id or s.tenant_id = t.id and t.parent_tenant_id is null),
  own as (select s.* from public.document_specifications s, t where s.tenant_id = t.id and t.parent_tenant_id is not null)
  select case when coalesce(m.locked,false) then m.id else coalesce(o.id, m.id) end, p_tenant, coalesce(m.code, o.code),
         case when m.locked or o.id is null then m.name else o.name end,
         case when m.locked or o.id is null then m.version else o.version end,
         case when m.locked or o.id is null then m.lifecycle_status else o.lifecycle_status end,
         coalesce(m.locked, o.locked, false),
         case when m.locked or o.id is null then m.definition else coalesce(m.definition, '{}'::jsonb) || o.definition end,
         case when m.id is not null and (o.id is null or m.locked) then 'master' else 'tenant' end,
         (m.id is not null and o.id is not null and not coalesce(m.locked,false)),
         case when m.id is not null and o.id is not null and not coalesce(m.locked,false)
              then (select array_agg(k) from jsonb_object_keys(o.definition) k)
              else '{}'::text[] end
  from master m full join own o on o.code = m.code
  where public.user_tenant() = p_tenant
     or (public.has_role('master_admin') and exists (select 1 from public.tenants x where x.id = p_tenant and x.parent_tenant_id = public.user_tenant()))
     -- server-side system API: the gateway pins p_tenant to the verified system key's tenant
     or auth.role() = 'service_role'
$function$;