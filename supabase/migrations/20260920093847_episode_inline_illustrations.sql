-- Episode inline illustrations: private Storage-backed assets referenced from plain-text episode bodies.
begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920093847'));

do $$
begin
  if to_regclass('public.episodes') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.novel_collaborators') is null
     or to_regclass('public.author_work_export_audit') is null
     or to_regprocedure('public.novelight_collaboration_can_edit(bigint,uuid)') is null
     or to_regprocedure('public.novelight_authorize_work_export(bigint,text)') is null then
    raise exception 'Episode illustration prerequisites are missing';
  end if;

  if to_regclass('public.episode_illustrations') is not null
     or to_regprocedure('public.novelight_episode_illustration_editor_bundle(bigint,uuid)') is not null
     or to_regprocedure('public.novelight_register_episode_illustration(bigint,uuid,text,text,bigint,integer,integer,text)') is not null
     or to_regprocedure('public.novelight_public_episode_illustration_bundle(bigint)') is not null then
    raise exception 'Episode illustration runtime already exists';
  end if;
end
$$;

alter table public.novels
  add column illustration_ai_usage boolean;

comment on column public.novels.illustration_ai_usage is
  'NULL until author declares illustration AI usage; false = no AI-generated/AI-assisted illustration, true = contains AI-generated/AI-assisted illustration.';

alter table public.author_work_export_audit
  drop constraint if exists author_work_export_audit_format_check;

alter table public.author_work_export_audit
  add constraint author_work_export_audit_format_check
  check (format in ('txt','zip'));

create or replace function public.novelight_authorize_work_export(
  p_novel_id bigint,
  p_format text default 'txt'
)
returns table (
  audit_id uuid,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_format text := lower(trim(coalesce(p_format, '')));
  v_now timestamptz := clock_timestamp();
  v_audit_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_novel_id is null or p_novel_id <= 0 then
    raise exception 'invalid_export_request' using errcode = '22023';
  end if;

  if v_format not in ('txt','zip') then
    raise exception 'unsupported_export_format' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('novelight:author-work-export:' || v_uid::text)
  );

  if not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_uid
  ) then
    raise exception 'export_not_found' using errcode = 'P0002';
  end if;

  if (
    select count(*)
      from public.author_work_export_audit a
     where a.user_id = v_uid
       and a.requested_at >= v_now - interval '10 minutes'
  ) >= 10 then
    raise exception 'author_export_rate_limited' using errcode = 'P0001';
  end if;

  if (
    select count(*)
      from public.author_work_export_audit a
     where a.user_id = v_uid
       and a.requested_at >= v_now - interval '24 hours'
  ) >= 50 then
    raise exception 'author_export_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.author_work_export_audit (
    user_id, novel_id, format, requested_at
  ) values (
    v_uid, p_novel_id, v_format, v_now
  )
  returning id into v_audit_id;

  return query select v_audit_id, v_now;
end
$$;

revoke all on function public.novelight_authorize_work_export(bigint,text)
  from public, anon, authenticated;
grant execute on function public.novelight_authorize_work_export(bigint,text)
  to authenticated;


create table public.episode_illustrations (
  id uuid primary key default gen_random_uuid(),
  episode_id bigint not null references public.episodes(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type = 'image/webp'),
  file_size bigint not null check (file_size between 1 and 10485760),
  width integer not null check (width between 1 and 2000),
  height integer not null check (height between 1 and 2000),
  alt_text text not null default '' check (pg_catalog.char_length(alt_text) <= 500),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint episode_illustrations_owner_creator_present
    check (owner_user_id is not null and created_by_user_id is not null)
);

create index episode_illustrations_episode_created_idx
  on public.episode_illustrations (episode_id, created_at, id);

create index episode_illustrations_novel_idx
  on public.episode_illustrations (novel_id, episode_id);

alter table public.episode_illustrations enable row level security;

revoke all on table public.episode_illustrations
  from public, anon, authenticated, service_role;

comment on table public.episode_illustrations is
  'Private episode illustration asset registry. Reader access is only through a server-side published-episode bundle and short-lived signed Storage URLs.';

create table public.episode_illustration_upload_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  episode_id bigint not null references public.episodes(id) on delete cascade,
  requested_at timestamptz not null default pg_catalog.now()
);

create index episode_illustration_upload_audit_user_requested_idx
  on public.episode_illustration_upload_audit (user_id, requested_at desc);

alter table public.episode_illustration_upload_audit enable row level security;

revoke all on table public.episode_illustration_upload_audit
  from public, anon, authenticated, service_role;
revoke all on sequence public.episode_illustration_upload_audit_id_seq
  from public, anon, authenticated, service_role;

comment on table public.episode_illustration_upload_audit is
  'Private abuse-control ledger for signed episode illustration upload issuance. It is never an evaluation, Rank, SCOUT, PV, favorite, discovery, or exposure signal.';

create or replace function public.novelight_authorize_episode_illustration_upload(
  p_episode_id bigint,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_episode record;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_user_id is null then
    raise exception using errcode='42501', message='Authenticated actor required';
  end if;

  select e.id, e.novel_id, e.user_id as owner_user_id
    into v_episode
    from public.episodes e
   where e.id = p_episode_id;

  if not found
     or not (
       v_episode.owner_user_id = p_actor_user_id
       or public.novelight_collaboration_can_edit(v_episode.novel_id, p_actor_user_id)
     ) then
    raise exception using errcode='42501', message='Episode illustration edit access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'novelight:episode-illustration-upload:' || p_actor_user_id::text,
      0
    )
  );

  delete from public.episode_illustration_upload_audit a
   where a.requested_at < v_now - interval '7 days';

  if (
    select pg_catalog.count(*)
      from public.episode_illustration_upload_audit a
     where a.user_id = p_actor_user_id
       and a.requested_at >= v_now - interval '10 minutes'
  ) >= 20 then
    raise exception using errcode='P0001', message='EPISODE_ILLUSTRATION_UPLOAD_RATE_LIMITED';
  end if;

  if (
    select pg_catalog.count(*)
      from public.episode_illustration_upload_audit a
     where a.user_id = p_actor_user_id
       and a.requested_at >= v_now - interval '24 hours'
  ) >= 100 then
    raise exception using errcode='P0001', message='EPISODE_ILLUSTRATION_UPLOAD_RATE_LIMITED';
  end if;

  insert into public.episode_illustration_upload_audit (
    user_id, episode_id, requested_at
  ) values (
    p_actor_user_id, p_episode_id, v_now
  );

  return true;
end
$$;
create or replace function public.novelight_episode_illustration_editor_bundle(
  p_episode_id bigint,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_episode record;
  v_can_edit boolean;
  v_assets jsonb;
begin
  if p_actor_user_id is null then
    raise exception using errcode='42501', message='Authenticated actor required';
  end if;

  select e.id, e.novel_id, e.user_id as owner_user_id, e.status, n.illustration_ai_usage
    into v_episode
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id;

  if not found then
    return null;
  end if;

  v_can_edit :=
    v_episode.owner_user_id = p_actor_user_id
    or public.novelight_collaboration_can_edit(v_episode.novel_id, p_actor_user_id);

  if not v_can_edit then
    return pg_catalog.jsonb_build_object(
      'episode_id', p_episode_id,
      'can_edit', false
    );
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', i.id,
        'storage_path', i.storage_path,
        'mime_type', i.mime_type,
        'file_size', i.file_size,
        'width', i.width,
        'height', i.height,
        'alt_text', i.alt_text,
        'created_at', i.created_at
      )
      order by i.created_at, i.id
    ),
    '[]'::jsonb
  )
    into v_assets
    from public.episode_illustrations i
   where i.episode_id = p_episode_id;

  return pg_catalog.jsonb_build_object(
    'episode_id', v_episode.id,
    'novel_id', v_episode.novel_id,
    'owner_user_id', v_episode.owner_user_id,
    'episode_status', v_episode.status,
    'can_edit', true,
    'is_owner', v_episode.owner_user_id = p_actor_user_id,
    'illustration_ai_usage', v_episode.illustration_ai_usage,
    'limit', 10,
    'assets', v_assets
  );
end
$$;

create or replace function public.novelight_set_illustration_ai_usage(
  p_novel_id bigint,
  p_actor_user_id uuid,
  p_value boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null or p_value is null then
    raise exception using errcode='22023', message='Owner and declaration are required';
  end if;

  update public.novels n
     set illustration_ai_usage = p_value
   where n.id = p_novel_id
     and n.user_id = p_actor_user_id;

  if not found then
    raise exception using errcode='42501', message='Novel not found or not owned by actor';
  end if;

  return true;
end
$$;
create or replace function public.novelight_register_episode_illustration(
  p_episode_id bigint,
  p_actor_user_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_file_size bigint,
  p_width integer,
  p_height integer,
  p_alt_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_episode record;
  v_id uuid;
  v_count integer;
  v_alt text := coalesce(p_alt_text, '');
  v_path_pattern text;
begin
  if p_actor_user_id is null then
    raise exception using errcode='42501', message='Authenticated actor required';
  end if;

  select e.id, e.novel_id, e.user_id as owner_user_id, n.illustration_ai_usage
    into v_episode
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
   for update of e;

  if not found
     or not (
       v_episode.owner_user_id = p_actor_user_id
       or public.novelight_collaboration_can_edit(v_episode.novel_id, p_actor_user_id)
     ) then
    raise exception using errcode='42501', message='Episode illustration edit access required';
  end if;

  if v_episode.illustration_ai_usage is null then
    raise exception using errcode='22023', message='ILLUSTRATION_AI_USAGE_REQUIRED';
  end if;

  if p_mime_type is distinct from 'image/webp'
     or p_file_size is null or p_file_size < 1 or p_file_size > 10485760
     or p_width is null or p_width < 1 or p_width > 2000
     or p_height is null or p_height < 1 or p_height > 2000
     or pg_catalog.char_length(v_alt) > 500 then
    raise exception using errcode='22023', message='Invalid optimized illustration metadata';
  end if;

  v_path_pattern :=
    '^' || v_episode.owner_user_id::text || '/' || p_episode_id::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$';

  if p_storage_path is null or p_storage_path !~ v_path_pattern then
    raise exception using errcode='22023', message='Invalid illustration storage path';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:episode-illustrations:' || p_episode_id::text, 0)
  );

  select pg_catalog.count(*)::integer
    into v_count
    from public.episode_illustrations i
   where i.episode_id = p_episode_id;

  if v_count >= 10 then
    raise exception using errcode='22023', message='EPISODE_ILLUSTRATION_LIMIT_REACHED';
  end if;

  insert into public.episode_illustrations (
    episode_id, novel_id, owner_user_id, created_by_user_id,
    storage_path, mime_type, file_size, width, height, alt_text
  ) values (
    p_episode_id, v_episode.novel_id, v_episode.owner_user_id, p_actor_user_id,
    p_storage_path, p_mime_type, p_file_size, p_width, p_height, v_alt
  )
  returning id into v_id;

  return v_id;
end
$$;

create or replace function public.novelight_update_episode_illustration_alt(
  p_illustration_id uuid,
  p_actor_user_id uuid,
  p_alt_text text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_alt text := coalesce(p_alt_text, '');
begin
  if p_actor_user_id is null then
    raise exception using errcode='42501', message='Authenticated actor required';
  end if;
  if pg_catalog.char_length(v_alt) > 500 then
    raise exception using errcode='22023', message='Alt text must be at most 500 characters';
  end if;

  select i.id, i.novel_id
    into v_row
    from public.episode_illustrations i
   where i.id = p_illustration_id
   for update;

  if not found
     or not public.novelight_collaboration_can_edit(v_row.novel_id, p_actor_user_id) then
    raise exception using errcode='42501', message='Episode illustration edit access required';
  end if;

  update public.episode_illustrations i
     set alt_text = v_alt,
         updated_at = pg_catalog.now()
   where i.id = p_illustration_id;

  return true;
end
$$;
create or replace function public.novelight_public_episode_illustration_bundle(
  p_episode_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_episode record;
  v_assets jsonb;
begin
  select e.id, e.novel_id, e.content, n.illustration_ai_usage
    into v_episode
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id = p_episode_id
     and e.status = 'published'
     and n.status = 'published';

  if not found then
    return null;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', i.id,
        'storage_path', i.storage_path,
        'width', i.width,
        'height', i.height,
        'alt_text', i.alt_text
      )
      order by i.created_at, i.id
    ),
    '[]'::jsonb
  )
    into v_assets
    from public.episode_illustrations i
   where i.episode_id = p_episode_id;

  return pg_catalog.jsonb_build_object(
    'episode_id', v_episode.id,
    'novel_id', v_episode.novel_id,
    'content', v_episode.content,
    'illustration_ai_usage', v_episode.illustration_ai_usage,
    'assets', v_assets
  );
end
$$;

create or replace function public.novelight_owner_illustration_export_bundle(
  p_novel_id bigint,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assets jsonb;
  v_ai_usage boolean;
begin
  select n.illustration_ai_usage
    into v_ai_usage
    from public.novels n
   where n.id = p_novel_id
     and n.user_id = p_actor_user_id;

  if p_actor_user_id is null or not found then
    raise exception using errcode='42501', message='Novel not found or not owned by actor';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', i.id,
        'episode_id', i.episode_id,
        'storage_path', i.storage_path,
        'mime_type', i.mime_type,
        'file_size', i.file_size,
        'width', i.width,
        'height', i.height,
        'alt_text', i.alt_text,
        'created_at', i.created_at
      )
      order by e.episode_number, e.id, i.created_at, i.id
    ),
    '[]'::jsonb
  )
    into v_assets
    from public.episode_illustrations i
    join public.episodes e on e.id = i.episode_id
   where i.novel_id = p_novel_id;

  return pg_catalog.jsonb_build_object(
    'novel_id', p_novel_id,
    'illustration_ai_usage', v_ai_usage,
    'assets', v_assets
  );
end
$$;
revoke all on function public.novelight_authorize_episode_illustration_upload(bigint,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_episode_illustration_editor_bundle(bigint,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_set_illustration_ai_usage(bigint,uuid,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_register_episode_illustration(bigint,uuid,text,text,bigint,integer,integer,text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_update_episode_illustration_alt(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_public_episode_illustration_bundle(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.novelight_owner_illustration_export_bundle(bigint,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.novelight_authorize_episode_illustration_upload(bigint,uuid)
  to service_role;
grant execute on function public.novelight_episode_illustration_editor_bundle(bigint,uuid)
  to service_role;
grant execute on function public.novelight_set_illustration_ai_usage(bigint,uuid,boolean)
  to service_role;
grant execute on function public.novelight_register_episode_illustration(bigint,uuid,text,text,bigint,integer,integer,text)
  to service_role;
grant execute on function public.novelight_update_episode_illustration_alt(uuid,uuid,text)
  to service_role;
grant execute on function public.novelight_public_episode_illustration_bundle(bigint)
  to service_role;
grant execute on function public.novelight_owner_illustration_export_bundle(bigint,uuid)
  to service_role;

do $$
declare
  v_public boolean;
  v_limit bigint;
  v_types text[];
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets unavailable; skipping episode-illustrations bucket bootstrap in migration replay';
    return;
  end if;

  insert into storage.buckets (
    id, name, public, file_size_limit, allowed_mime_types
  ) values (
    'episode-illustrations',
    'episode-illustrations',
    false,
    10485760,
    array['image/webp']
  )
  on conflict (id) do nothing;

  select b.public, b.file_size_limit, b.allowed_mime_types
    into v_public, v_limit, v_types
    from storage.buckets b
   where b.id = 'episode-illustrations';

  if v_public is distinct from false then
    raise exception 'episode-illustrations bucket must remain private';
  end if;
  if v_limit is distinct from 10485760 then
    raise exception 'episode-illustrations bucket file-size limit must remain 10 MB';
  end if;
  if v_types is null or v_types <> array['image/webp']::text[] then
    raise exception 'episode-illustrations bucket MIME allowlist must remain image/webp only';
  end if;
end
$$;

comment on function public.novelight_public_episode_illustration_bundle(bigint) is
  'Service-only published-episode illustration metadata. Caller must filter assets to IDs referenced by current content before signing URLs.';
comment on function public.novelight_owner_illustration_export_bundle(bigint,uuid) is
  'Service-only owner export metadata used to keep illustration references and binary assets recoverable in work backups.';

commit;
