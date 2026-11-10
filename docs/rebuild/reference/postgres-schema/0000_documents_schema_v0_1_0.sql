-- Document Management prototype schema v0.1.0 (Lovable Cloud / Postgres).
-- Not executed here. Lovable applies it from prompt 01; run its security scan afterwards.
-- Rules encoded: tenant isolation, master/child configuration inheritance, immutable versions,
-- append-only audit, two axes (status vs pipeline_state), writes only through edge functions (service role).
-- Synthetic data only.

create type public.doc_status      as enum ('draft','in_review','approved','effective','superseded','expired','archived');
create type public.pipeline_state  as enum ('uploading','scanning','reading','ready','failed','quarantined');
create type public.sensitivity     as enum ('public','internal','confidential','restricted');
create type public.signature_level as enum ('none','simple','advanced','qualified');
create type public.app_role        as enum ('viewer','contributor','reviewer','manager','tenant_admin','master_admin');
create type public.access_level    as enum ('view','edit','manage');
create type public.extraction_status as enum ('pending','accepted','edited','rejected');

-- Tenants -----------------------------------------------------------------------------------------
create table public.tenants (
  id text primary key,
  display_name text not null,
  role text not null check (role in ('master','child')),
  parent_tenant_id text references public.tenants(id),
  frontend_strategy text not null default 'common' check (frontend_strategy in ('common','customized','dedicated','external')),
  cross_tenant_share text not null default 'off' check (cross_tenant_share in ('off','explicitGrant')),
  master_supervision text not null default 'none' check (master_supervision in ('none','metadataOnly','auditOnGrant')),
  hard_floors jsonb not null default '{}'::jsonb,
  inheritance jsonb not null default '{}'::jsonb,
  check ((role = 'child') = (parent_tenant_id is not null))
);

create table public.profiles (              -- display names readable inside the tenant ("granted by", "set by", activity rows)
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id text not null references public.tenants(id),
  display_name text not null
);

create table public.user_roles (            -- roles live apart from profiles on purpose
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null references public.tenants(id),
  role public.app_role not null,
  display_name text,
  primary key (user_id)                                         -- ONE user, ONE tenant, ONE role (AGENTS.md rule 5); enforced, not assumed
);

-- master_admin only on a master tenant (a CHECK cannot subquery, so a trigger).
create or replace function public.user_roles_guard() returns trigger language plpgsql as $$
begin
  if new.role = 'master_admin' and not exists (select 1 from public.tenants where id = new.tenant_id and role = 'master') then
    raise exception 'master_admin only on a master tenant';
  end if;
  return new;
end $$;
create trigger user_roles_guard before insert or update on public.user_roles for each row execute function public.user_roles_guard();

create or replace function public.user_tenant() returns text
language sql stable security definer set search_path = public as $$
  select tenant_id from public.user_roles where user_id = auth.uid()        -- unique by primary key
$$;

create or replace function public.has_role(_role public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = _role and tenant_id = public.user_tenant())
$$;

-- Business entities the documents belong to (quote, order, account...) ---------------------------------
create table public.business_entities (
  id text primary key,
  tenant_id text not null references public.tenants(id),
  referred_type text not null check (referred_type in ('Account','Quote','ProductOrder','Contract','Line','Customer')),
  display_name text not null,
  status_label text
);
create table public.entity_access (          -- who can see an entity, and so its documents (rule 4)
  entity_id text not null references public.business_entities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  level public.access_level not null default 'view',
  primary key (entity_id, user_id)
);

-- Configuration: master defines, child inherits / extends / overrides / is locked ------------------------
create table public.document_specifications (
  id text primary key,
  tenant_id text not null references public.tenants(id),       -- master tenant id for shared definitions
  code text not null,                                           -- documentType
  name text not null,
  version text not null default '1',
  lifecycle_status text not null default 'active' check (lifecycle_status in ('inDesign','active','retired')),
  locked boolean not null default false,                        -- master forbids child change
  definition jsonb not null default '{}'::jsonb,                -- specCharacteristic, acceptedMimeTypes, maxSizeMb, requiresReview, signatureRequired, storesPersonalData...
  unique (tenant_id, code)
);
create table public.retention_policies (
  id text primary key,
  tenant_id text not null references public.tenants(id),
  code text not null,
  name text not null,
  retain_days integer not null check (retain_days >= 0),
  locked boolean not null default false,
  unique (tenant_id, code)
);

-- Effective specifications for the caller's tenant: child row wins by code unless the master row is locked.
create or replace function public.effective_specifications(p_tenant text default public.user_tenant())
returns table (id text, tenant_id text, code text, name text, version text, lifecycle_status text, locked boolean,
               definition jsonb, defined_in text, overridden boolean, overridden_fields text[])
language sql stable security definer set search_path = public as $$
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
              then (select array_agg(k) from jsonb_object_keys(o.definition) k)   -- keys the child set; the UI shows "Changed here" on these
              else '{}'::text[] end
  from master m full join own o on o.code = m.code
  where public.user_tenant() = p_tenant
     or (public.has_role('master_admin') and exists (select 1 from public.tenants x where x.id = p_tenant and x.parent_tenant_id = public.user_tenant()))
$$;

-- Documents -------------------------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id),
  name text not null check (char_length(name) between 1 and 255),
  description text,
  document_type text not null,
  status public.doc_status not null default 'draft',
  pipeline_state public.pipeline_state not null default 'uploading',
  pipeline_detail jsonb,                                        -- {failedStep, reasonKey, retryable}
  sensitivity public.sensitivity not null default 'internal',
  signature_level public.signature_level not null default 'none',
  effective_date date,                                          -- maps to validFor.startDateTime (legal/commercial effect)
  valid_to date,                                                -- maps to validFor.endDateTime (for example a contract end)
  expiry_date date,                                             -- administrative expiry (TMF667 expiryDate); reaching it moves status to expired
  origin text not null default 'uploaded' check (origin in ('uploaded','generated')),
  generated_from_spec text,                                     -- DocumentSpecification used when origin = generated
  bundle_id text,                                               -- DocumentSet membership (core + annexes)
  bundle_role text check (bundle_role in ('core','annex')),
  retention_policy_id text references public.retention_policies(id),
  retain_until date,
  legal_hold boolean not null default false,
  hold_reason text,
  hold_set_by uuid references auth.users(id),
  characteristic jsonb not null default '[]'::jsonb,
  current_version_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                                        -- soft delete = recoverable (undo over confirm)
);
create index documents_tenant_status on public.documents (tenant_id, status) where deleted_at is null;
create index documents_search on public.documents using gin (to_tsvector('simple', name || ' ' || coalesce(description,'')));

create table public.document_relations (                        -- document belongs to entities; folders are only a view
  document_id uuid not null references public.documents(id) on delete cascade,
  entity_id text not null references public.business_entities(id),
  role text not null,
  attached_on timestamptz not null default now(),               -- SID Attachment.attachedOnDateTime
  primary key (document_id, entity_id, role)
);
create table public.document_access_exceptions (                -- explicit, visible exceptions to inherited access
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  level public.access_level not null,
  granted_by uuid references auth.users(id),
  expires_at timestamptz,
  primary key (document_id, user_id)
);
create table public.cross_tenant_grants (
  document_id uuid not null references public.documents(id) on delete cascade,
  to_tenant text not null references public.tenants(id),
  level public.access_level not null default 'view',
  granted_by uuid references auth.users(id),
  expires_at timestamptz,
  revoked_at timestamptz,
  primary key (document_id, to_tenant)
);

create table public.document_versions (                         -- immutable (rule 3)
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  tenant_id text not null references public.tenants(id),
  label text not null,
  is_named boolean not null default false,
  note text,
  mime_type text not null,
  attachment_type text not null default 'contractCopy',         -- TMF667 Attachment.attachmentType is required
  size_bytes bigint,
  content_hash text not null,                                   -- the model requires it; a version without a hash is not a version
  storage_path text,                                            -- Storage object; seeded rows use 'sample/<type>'
  sample_pages jsonb,                                           -- PROTOTYPE ONLY: generated pages (lines + boxes) so preview and extraction highlights work without real files
  supersedes uuid references public.document_versions(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.documents add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions(id) deferrable initially deferred;

create table public.extraction_fields (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.document_versions(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  tenant_id text not null references public.tenants(id),
  name text not null,
  value jsonb,
  original_value jsonb,
  confidence numeric check (confidence between 0 and 1),
  band text check (band in ('high','medium','low')),
  source jsonb,                                                 -- {page, box:{x,y,w,h}, excerpt}
  status public.extraction_status not null default 'pending',
  spot_check boolean not null default false,                    -- seeded, deterministic sample of High fields kept for review (never random in the prototype)
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

create table public.document_events (                           -- append-only audit; never carries content
  id bigint generated always as identity primary key,
  tenant_id text not null references public.tenants(id),
  document_id uuid references public.documents(id) on delete set null,
  version_id uuid,
  actor uuid,
  action text not null,                                         -- view, download, share, statusChange, restore, hold, delete, accessDenied, upload, pipelineStateChange
  detail text,
  created_at timestamptz not null default now()
);

create table public.idempotency_keys (
  key text not null,
  tenant_id text not null,
  operation text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key, operation)
);

-- Immutability and append-only ---------------------------------------------------------------------------
create or replace function public.block_mutation() returns trigger language plpgsql as $$
begin raise exception '% is immutable', tg_table_name using errcode = '55000'; end $$;
create trigger versions_immutable before update or delete on public.document_versions
  for each row execute function public.block_mutation();
create trigger events_append_only before update or delete on public.document_events
  for each row execute function public.block_mutation();

-- Access (RLS). Reads only; every write goes through edge functions with the service role. ------------------
create or replace function public.can_see_document(_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.documents d
    where d.id = _doc and d.deleted_at is null and (
      ( d.tenant_id = public.user_tenant() and (
          public.has_role('tenant_admin')
          or exists (select 1 from public.document_relations r join public.entity_access a on a.entity_id = r.entity_id
                     where r.document_id = d.id and a.user_id = auth.uid())
          or exists (select 1 from public.document_access_exceptions x
                     where x.document_id = d.id and x.user_id = auth.uid() and (x.expires_at is null or x.expires_at > now())) ) )
      or exists (select 1 from public.cross_tenant_grants g
                 where g.document_id = d.id and g.to_tenant = public.user_tenant() and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()))
    ))
$$;

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.business_entities enable row level security;
alter table public.entity_access enable row level security;
alter table public.document_specifications enable row level security;
alter table public.retention_policies enable row level security;
alter table public.documents enable row level security;
alter table public.document_relations enable row level security;
alter table public.document_access_exceptions enable row level security;
alter table public.cross_tenant_grants enable row level security;
alter table public.document_versions enable row level security;
alter table public.extraction_fields enable row level security;
alter table public.document_events enable row level security;
alter table public.idempotency_keys enable row level security;        -- no policy: service role only

create policy tenants_read on public.tenants for select to authenticated
  using (id = public.user_tenant()
      or id = (select parent_tenant_id from public.tenants where id = public.user_tenant())
      or (parent_tenant_id = public.user_tenant() and public.has_role('master_admin')));  -- a master sees its children's settings, never their documents
create policy user_roles_self on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy profiles_tenant on public.profiles for select to authenticated using (tenant_id = public.user_tenant());
create policy entities_read on public.business_entities for select to authenticated
  using (tenant_id = public.user_tenant() and (public.has_role('tenant_admin')
         or exists (select 1 from public.entity_access a where a.entity_id = id and a.user_id = auth.uid())));
create policy entity_access_self on public.entity_access for select to authenticated
  using (user_id = auth.uid() or (public.has_role('tenant_admin')
         and exists (select 1 from public.business_entities e where e.id = entity_id and e.tenant_id = public.user_tenant())));
create policy specs_read on public.document_specifications for select to authenticated
  using (tenant_id = public.user_tenant() or tenant_id = (select parent_tenant_id from public.tenants where id = public.user_tenant()));
create policy retention_read on public.retention_policies for select to authenticated
  using (tenant_id = public.user_tenant() or tenant_id = (select parent_tenant_id from public.tenants where id = public.user_tenant()));
create policy documents_read on public.documents for select to authenticated using (public.can_see_document(id));
create policy relations_read on public.document_relations for select to authenticated using (public.can_see_document(document_id));
create policy exceptions_read on public.document_access_exceptions for select to authenticated using (public.can_see_document(document_id));
create policy grants_read on public.cross_tenant_grants for select to authenticated
  using (public.can_see_document(document_id) and (public.has_role('manager') or public.has_role('tenant_admin')));
create policy versions_read on public.document_versions for select to authenticated using (public.can_see_document(document_id));
create policy extraction_read on public.extraction_fields for select to authenticated using (public.can_see_document(document_id));
create policy events_read on public.document_events for select to authenticated
  using ((document_id is not null and public.can_see_document(document_id))
      or (document_id is null and tenant_id = public.user_tenant() and public.has_role('tenant_admin')));  -- configuration audit

-- Master supervision: counts and states only, never names, fields or content. -------------------------------
create or replace view public.master_document_stats with (security_invoker = false) as
  select d.tenant_id, d.document_type, d.status, d.pipeline_state, count(*)::int as documents
  from public.documents d
  join public.tenants c on c.id = d.tenant_id and c.parent_tenant_id is not null
  join public.tenants m on m.id = c.parent_tenant_id and c.master_supervision <> 'none'   -- the CHILD's setting governs (tenant-policy.schema.json dataIsolation)
  where d.deleted_at is null and public.has_role('master_admin') and public.user_tenant() = m.id
  group by d.tenant_id, d.document_type, d.status, d.pipeline_state;
revoke all on public.master_document_stats from public, anon;
grant select on public.master_document_stats to authenticated;
-- Accepted lint finding: this view is SECURITY DEFINER on purpose (counts only, never names). Do not flip it to security_invoker.

-- Function exposure. Postgres grants EXECUTE to PUBLIC on every new function; PostgREST exposes public.* as RPC.
-- Revoke from PUBLIC (not just anon/authenticated) and grant back only what the browser needs.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.user_tenant() to authenticated;
grant execute on function public.has_role(public.app_role) to authenticated;
grant execute on function public.can_see_document(uuid) to authenticated;
grant execute on function public.effective_specifications(text) to authenticated;
-- block_mutation, user_roles_guard: trigger functions, no caller needed.

-- Storage: one PRIVATE bucket, no storage.objects policy for authenticated at all.
-- Reads only via signed URLs minted by the edge function after the 423 check; uploads only via signed upload URLs from the edge function.
-- Object key = <tenant_id>/<version_id> (never the file name). On quarantine the function deletes the object and keeps only the hash.
-- [Lovable] bucket 'documents' (private) is created with the storage tool; SQL writes to storage.buckets are not allowed.

-- Erasure: an employee's auth account must be deletable without breaking rows.
alter table public.documents alter column hold_set_by drop not null;
alter table public.documents drop constraint if exists documents_created_by_fkey,  add constraint documents_created_by_fkey  foreign key (created_by)  references auth.users(id) on delete set null;
alter table public.documents drop constraint if exists documents_hold_set_by_fkey, add constraint documents_hold_set_by_fkey foreign key (hold_set_by) references auth.users(id) on delete set null;
alter table public.document_access_exceptions drop constraint if exists document_access_exceptions_granted_by_fkey, add constraint document_access_exceptions_granted_by_fkey foreign key (granted_by) references auth.users(id) on delete set null;
alter table public.cross_tenant_grants drop constraint if exists cross_tenant_grants_granted_by_fkey, add constraint cross_tenant_grants_granted_by_fkey foreign key (granted_by) references auth.users(id) on delete set null;
alter table public.document_versions drop constraint if exists document_versions_created_by_fkey, add constraint document_versions_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.extraction_fields drop constraint if exists extraction_fields_reviewed_by_fkey, add constraint extraction_fields_reviewed_by_fkey foreign key (reviewed_by) references auth.users(id) on delete set null;
-- Audit detail is a code plus a reference, never free text with personal data (AGENTS.md rule 8).
alter table public.document_events add constraint events_detail_short check (char_length(detail) <= 160);
-- Idempotency replay is bound to the caller and expires.
alter table public.idempotency_keys add column actor uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.idempotency_keys drop constraint idempotency_keys_pkey, add primary key (tenant_id, actor, key, operation);

alter publication supabase_realtime add table public.documents;   -- pipeline_state changes drive the row status in the UI. RLS filters insert/update payloads per subscriber; DELETE payloads are not filtered, so never hard-delete while clients are connected.

-- [Lovable] Data API grants: Supabase no longer grants table privileges by default. Reads stay governed by the RLS policies above; writes only via service role.
grant select on public.tenants, public.profiles, public.user_roles, public.business_entities, public.entity_access,
  public.document_specifications, public.retention_policies, public.documents, public.document_relations,
  public.document_access_exceptions, public.cross_tenant_grants, public.document_versions, public.extraction_fields,
  public.document_events to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
