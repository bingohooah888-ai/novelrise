-- DESIGN DRAFT ONLY. Do not place under supabase/migrations or execute.
-- Verify existing public grants, default privileges, DB roles and RLS
-- in isolated testing before preparing a production migration.
begin;

create table public.special_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(title) between 1 and 180),
  kind text not null check (kind in ('ss','extra','interview','other')),
  summary text not null default '',
  description text not null default '',
  author_name text not null default '',
  author_bio text not null default '',
  author_x_url text,
  author_other_url text,
  work_title text not null default '',
  work_description text not null default '',
  work_url text,
  novel_id bigint,
  cover_url text,
  ogp_url text,
  featured boolean not null default false,
  sort_order integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  limited_label boolean not null default false,
  pr_label boolean not null default false,
  seo_title text,
  seo_description text,
  campaign_key text,
  status text not null default 'draft'
    check (status in ('draft','pending','published','paused','ended')),
  first_published_at timestamptz,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create index special_projects_public_idx on public.special_projects
  (status, featured desc, sort_order, id);

create table public.special_contents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.special_projects(id) on delete restrict,
  title text not null check (length(title) between 1 and 180),
  kind text not null default 'ss',
  mode text not null check (mode in ('episode','external','inline')),
  body text,
  episode_id bigint,
  external_url text,
  sort_order integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft','published')),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mode <> 'inline' or nullif(trim(body),'') is not null)
    and (mode <> 'episode' or episode_id is not null)
    and (mode <> 'external' or external_url is not null)
  )
);
create index special_contents_project_idx on public.special_contents
  (project_id,sort_order,id);
alter table public.special_contents
  add constraint special_contents_identity_project_key unique (id,project_id);

create table public.special_permissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.special_projects(id) on delete restrict,
  content_id uuid references public.special_contents(id) on delete restrict,
  kind text not null check (kind in ('project','content','cover','ogp')),
  rights_holder text not null check (length(trim(rights_holder)) > 0),
  permission_scope text not null check (length(trim(permission_scope)) > 0),
  evidence_reference text not null check (length(trim(evidence_reference)) > 0),
  private_notes text,
  approved_digest char(64) not null,
  valid_from timestamptz,
  expires_at timestamptz,
  confirmed_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  approved_by uuid not null,
  created_at timestamptz not null default now(),
  check ((kind = 'content' and content_id is not null) or
         (kind <> 'content' and content_id is null)),
  check (expires_at is null or valid_from is null or expires_at > valid_from)
);
create index special_permissions_project_idx on public.special_permissions
  (project_id,kind,content_id);
alter table public.special_permissions
  add constraint special_permissions_same_project_fk
  foreign key (content_id,project_id)
  references public.special_contents(id,project_id) on delete restrict;

create table public.special_change_log (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.special_projects(id) on delete restrict,
  content_id uuid,
  actor_id uuid not null,
  operation text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
create index special_change_log_project_idx on public.special_change_log
  (project_id, created_at desc);

create table public.special_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.special_projects(id) on delete restrict,
  event_type text not null check (event_type in ('page_view','content_click','novel_click','official_click')),
  visitor_hash text not null,
  target text not null default '',
  event_minute timestamptz not null,
  created_at timestamptz not null default now(),
  unique (project_id,event_type,visitor_hash,target,event_minute)
);
create index special_events_recent_idx on public.special_events
  (project_id,created_at desc);

alter table public.special_projects enable row level security;
alter table public.special_contents enable row level security;
alter table public.special_permissions enable row level security;
alter table public.special_change_log enable row level security;
alter table public.special_events enable row level security;

-- All public reading is through same-origin SSR endpoints after rights filtering.
-- Do not provide direct browser access to any of these raw tables.
revoke all on table public.special_projects, public.special_contents,
  public.special_permissions, public.special_change_log,
  public.special_events from public, anon, authenticated;

grant all on table public.special_projects, public.special_contents,
  public.special_permissions, public.special_change_log,
  public.special_events to service_role;


-- Private contract/email proof. Existing Supabase Storage is required for
-- Production; compatibility replay without storage skips bucket bootstrap.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'special-evidence Storage unavailable in isolated migration replay';
    return;
  end if;
  insert into storage.buckets
    (id,name,public,file_size_limit,allowed_mime_types)
  values
    ('special-evidence','special-evidence',false,10485760,
     array['application/pdf','image/png','image/jpeg','image/webp']::text[])
  on conflict (id) do nothing;
  if not exists (
    select 1 from storage.buckets
    where id='special-evidence' and public=false
      and file_size_limit<=10485760
  ) then
    raise exception 'special-evidence bucket must remain private and bounded';
  end if;
end
$$;

-- Atomic, append-only audit snapshots for every row mutation.
-- Audit failures roll back the originating INSERT/UPDATE/DELETE.
create or replace function public.special_audit_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid;
  pid uuid;
  cid uuid;
  prior jsonb;
  subsequent jsonb;
  operation_name text;
begin
  if tg_op = 'INSERT' then
    subsequent := to_jsonb(new);
    prior := null;
  elsif tg_op = 'UPDATE' then
    subsequent := to_jsonb(new);
    prior := to_jsonb(old);
  else
    subsequent := null;
    prior := to_jsonb(old);
  end if;

  if tg_table_name = 'special_projects' then
    actor := case when tg_op='DELETE' then old.updated_by else new.updated_by end;
    pid := case when tg_op='DELETE' then old.id else new.id end;
    cid := null;
    operation_name := 'project.' || lower(tg_op);
    if tg_op='UPDATE' and old.status is distinct from new.status then
      operation_name := 'status.' || new.status;
    end if;
  elsif tg_table_name = 'special_contents' then
    actor := case when tg_op='DELETE' then old.updated_by else new.updated_by end;
    pid := case when tg_op='DELETE' then old.project_id else new.project_id end;
    cid := case when tg_op='DELETE' then old.id else new.id end;
    operation_name := 'content.' || lower(tg_op);
  elsif tg_table_name = 'special_permissions' then
    actor := case when tg_op='INSERT' then new.approved_by
             when tg_op='UPDATE' then new.revoked_by
             else old.revoked_by end;
    pid := case when tg_op='DELETE' then old.project_id else new.project_id end;
    cid := case when tg_op='DELETE' then old.content_id else new.content_id end;
    operation_name := 'rights.' || lower(tg_op);
    prior := prior - 'private_notes' - 'evidence_reference';
    subsequent := subsequent - 'private_notes' - 'evidence_reference';
  else
    raise exception 'unsupported special audit entity';
  end if;
  if actor is null then raise exception 'special audit actor is required'; end if;
  insert into public.special_change_log
    (project_id,content_id,actor_id,operation,before_value,after_value)
  values (pid,cid,actor,operation_name,prior,subsequent);
  return case when tg_op='DELETE' then old else new end;
end
$$;


-- Freeze public slug after first publication (even direct service mutations).
create or replace function public.special_guard_published_slug()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  if old.first_published_at is not null and new.slug is distinct from old.slug then
    raise exception 'SPECIAL_PUBLISHED_SLUG_IMMUTABLE';
  end if;
  return new;
end
$$;
create trigger special_published_slug_lock
before update on public.special_projects
for each row execute function public.special_guard_published_slug();

create trigger special_project_audit
after insert or update or delete on public.special_projects
for each row execute function public.special_audit_row();
create trigger special_content_audit
after insert or update or delete on public.special_contents
for each row execute function public.special_audit_row();
create trigger special_rights_audit
after insert or update or delete on public.special_permissions
for each row execute function public.special_audit_row();

-- Immutable revisions: restoring a revision must write a NEW row version.
create or replace function public.special_prevent_audit_mutation()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  raise exception 'SPECIAL_AUDIT_IMMUTABLE';
end
$$;
create trigger special_audit_immutable before update or delete
on public.special_change_log for each row
execute function public.special_prevent_audit_mutation();

revoke all on function public.special_guard_published_slug()
  from public,anon,authenticated;
grant execute on function public.special_guard_published_slug() to service_role;
revoke all on function public.special_audit_row() from public,anon,authenticated;
revoke all on function public.special_prevent_audit_mutation()
  from public,anon,authenticated;
grant execute on function public.special_audit_row() to service_role;
grant execute on function public.special_prevent_audit_mutation() to service_role;

-- IMPORTANT BLOCKERS BEFORE CONVERSION TO EXECUTABLE MIGRATION:
-- 1. DB row writes audit atomically; validate fail-closed multi-step workflows.
-- 2. Add durable revision restoration with permission-safe takedown.
-- 3. Same-project FK added; test mismatch rejection in isolated DB.
-- 4. Validate private evidence upload, orphan cleanup, and public image lifecycle.
-- 5. Test schema grants/RLS and all fails-closed using the isolated DB.
-- 6. Review URL and inline-content rating policy and access restrictions.
commit;
