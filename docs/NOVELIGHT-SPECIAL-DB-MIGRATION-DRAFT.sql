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
  approved_by uuid not null,
  created_at timestamptz not null default now(),
  check ((kind = 'content' and content_id is not null) or
         (kind <> 'content' and content_id is null)),
  check (expires_at is null or valid_from is null or expires_at > valid_from)
);
create index special_permissions_project_idx on public.special_permissions
  (project_id,kind,content_id);

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

-- IMPORTANT BLOCKERS BEFORE CONVERSION TO EXECUTABLE MIGRATION:
-- 1. Move admin state mutation, rights records and audit logging into one
--    atomic function per operation or another transaction-backed design.
-- 2. Add durable revision restoration with permission-safe takedown.
-- 3. Validate content's same-project foreign-key consistency.
-- 4. Build private Storage evidence workflow and image licensing lifecycle.
-- 5. Test schema grants/RLS and all fails-closed using the isolated DB.
-- 6. Review URL and inline-content rating policy and access restrictions.
commit;
