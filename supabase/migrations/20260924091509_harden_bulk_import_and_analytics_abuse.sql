-- AUDIT-004 / AUDIT-005: bound bulk-import resource use and analytics growth.
--
-- Limits are enforced at the database boundary. The public RPC signatures stay
-- stable so existing clients continue to work, while all identities are derived
-- from auth.uid() or a server-hashed visitor token.

begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20260924091509')
);

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.bulk_import_events') is null
     or to_regclass('public.scout_record_usage_days') is null
     or to_regclass('public.acquisition_touches') is null
     or to_regclass('public.beta_activity_days') is null
     or to_regclass('public.reader_journey_events') is null
     or to_regclass('public.episode_pv_events') is null
     or to_regclass('public.neutral_search_impression_telemetry') is null then
    raise exception 'AUDIT-004/005 prerequisite tables are missing';
  end if;

  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'pgcrypto digest(bytea,text) is required in the extensions schema';
  end if;

  if to_regprocedure('public.novelight_import_episode_drafts(bigint,jsonb)') is null
     or to_regprocedure('public.novelight_bulk_import_episode_drafts(bigint,jsonb)') is null
     or to_regprocedure('public.novelight_record_bulk_import_event(text,bigint,integer)') is null
     or to_regprocedure('public.novelight_record_scout_record_visit()') is null
     or to_regprocedure('public.record_beta_visit(text,text,text)') is null
     or to_regprocedure('public.record_acquisition_touch(text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.record_reader_journey_event(text,text,text,text,text)') is null
     or to_regprocedure('public.record_episode_pv(text,text)') is null
     or to_regprocedure('public.record_neutral_search_impressions(text[],text)') is null then
    raise exception 'AUDIT-004/005 prerequisite RPCs are missing';
  end if;

  if to_regclass('public.bulk_import_requests') is not null
     or to_regprocedure(
       'private.novelight_reserve_bulk_import(uuid,bigint,text,text,integer,bigint)'
     ) is not null then
    raise exception 'AUDIT-004/005 hardening objects already exist; reconcile before applying';
  end if;

  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.novels'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.episodes'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.bulk_import_events'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.scout_record_usage_days'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.acquisition_touches'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.beta_activity_days'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.reader_journey_events'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.episode_pv_events'::regclass) then
    raise exception 'RLS prerequisites must remain enabled';
  end if;
end
$$;

alter table public.neutral_search_impression_telemetry enable row level security;
revoke all on table public.neutral_search_impression_telemetry
  from public, anon, authenticated;

create or replace function public.record_reader_journey_event(
  p_event_type text,
  p_novel_id text,
  p_episode_id text default null,
  p_visitor_token text default null,
  p_source text default 'direct'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := pg_catalog.btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_author_id uuid;
  v_source text := pg_catalog.lower(
    coalesce(nullif(pg_catalog.btrim(coalesce(p_source, '')), ''), 'direct')
  );
  v_now timestamptz := pg_catalog.now();
  v_hour timestamptz := pg_catalog.date_trunc('hour', v_now);
  v_day_start timestamptz;
  v_inserted integer := 0;
begin
  if p_event_type not in ('detail_open', 'episode_read_10s', 'favorite_added', 'light_seed') then
    raise exception using errcode = '22023', message = 'Unsupported journey event';
  end if;

  if pg_catalog.char_length(v_source) > 40 then
    raise exception using errcode = '22023', message = 'Traffic source is too long';
  end if;

  select n.user_id into v_author_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';
  if not found then return false; end if;

  if v_uid is not null and v_uid = v_author_id then
    return false;
  end if;

  if p_event_type = 'episode_read_10s' then
    if p_episode_id is null or not exists (
      select 1 from public.episodes e
       where e.id::text = p_episode_id
         and e.novel_id::text = p_novel_id
         and e.status = 'published'
    ) then
      raise exception using errcode = '23514', message = 'Published episode is required';
    end if;
  elsif p_episode_id is not null then
    raise exception using errcode = '22023', message = 'This event must not include an episode';
  end if;

  if p_event_type = 'favorite_added' then
    if v_uid is null or not exists (
      select 1 from public.favorites f
       where f.user_id = v_uid and f.novel_id::text = p_novel_id
    ) then return false; end if;
  end if;

  if p_event_type = 'light_seed' then
    if v_uid is null or not exists (
      select 1 from public.light_seeds s
       where s.reader_id = v_uid and s.novel_id_snapshot = p_novel_id
    ) then return false; end if;
  end if;

  if v_uid is not null then
    v_hash := pg_catalog.md5('user:' || v_uid::text);
  else
    if pg_catalog.char_length(v_token) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'Visitor token is invalid';
    end if;
    v_hash := pg_catalog.md5('visitor:' || v_token);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:reader-journey:' || v_hash, 0)
  );

  if exists (
    select 1
      from public.reader_journey_events e
     where e.viewer_key_hash = v_hash
       and e.event_type = p_event_type
       and e.novel_id_snapshot = p_novel_id
       and e.episode_id_snapshot is not distinct from p_episode_id
       and e.event_hour = v_hour
  ) then
    return false;
  end if;

  if (
    select pg_catalog.count(*)
      from public.reader_journey_events e
     where e.viewer_key_hash = v_hash
       and e.occurred_at >= v_now - interval '1 hour'
  ) >= 120 then
    raise exception using errcode = 'P0001', message = 'Reader journey hourly limit exceeded';
  end if;

  v_day_start := pg_catalog.timezone(
    'Asia/Tokyo',
    pg_catalog.timezone('Asia/Tokyo', v_now)::date
  );

  if (
    select pg_catalog.count(*)
      from public.reader_journey_events e
     where e.viewer_key_hash = v_hash
       and e.occurred_at >= v_day_start
  ) >= 1000 then
    raise exception using errcode = 'P0001', message = 'Reader journey daily limit exceeded';
  end if;

  insert into public.reader_journey_events (
    viewer_key_hash,
    user_id,
    event_type,
    novel_id_snapshot,
    episode_id_snapshot,
    source,
    occurred_at,
    event_hour
  ) values (
    v_hash,
    v_uid,
    p_event_type,
    p_novel_id,
    p_episode_id,
    v_source,
    v_now,
    v_hour
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end
$$;

create or replace function public.record_episode_pv(
  p_episode_id text,
  p_visitor_token text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_episode_id text;
  v_novel_id text;
  v_author_id uuid;
  v_token text := pg_catalog.btrim(coalesce(p_visitor_token, ''));
  v_viewer_key_hash text;
  v_now timestamptz := pg_catalog.now();
  v_day_start timestamptz;
  v_rows integer;
begin
  if p_episode_id is null or pg_catalog.btrim(p_episode_id) = '' then
    return false;
  end if;

  select e.id::text, e.novel_id::text, n.user_id
    into v_episode_id, v_novel_id, v_author_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id::text = pg_catalog.btrim(p_episode_id)
     and e.status = 'published'
     and n.status = 'published';

  if not found then return false; end if;
  if v_uid is not null and v_uid = v_author_id then return false; end if;

  if v_uid is not null then
    v_viewer_key_hash := pg_catalog.md5('user:' || v_uid::text);
  else
    if pg_catalog.char_length(v_token) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'Visitor token is invalid';
    end if;
    v_viewer_key_hash := pg_catalog.md5('visitor:' || v_token);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_viewer_key_hash),
    pg_catalog.hashtext(v_episode_id)
  );

  if exists (
    select 1
      from public.episode_pv_events p
     where p.viewer_key_hash = v_viewer_key_hash
       and p.episode_id_snapshot = v_episode_id
       and p.counted_at >= v_now - interval '6 hours'
  ) then
    return false;
  end if;

  if (
    select pg_catalog.count(*)
      from public.episode_pv_events p
     where p.viewer_key_hash = v_viewer_key_hash
       and p.counted_at >= v_now - interval '1 hour'
  ) >= 120 then
    raise exception using errcode = 'P0001', message = 'Episode PV hourly limit exceeded';
  end if;

  v_day_start := pg_catalog.timezone(
    'Asia/Tokyo',
    pg_catalog.timezone('Asia/Tokyo', v_now)::date
  );

  if (
    select pg_catalog.count(*)
      from public.episode_pv_events p
     where p.viewer_key_hash = v_viewer_key_hash
       and p.counted_at >= v_day_start
  ) >= 500 then
    raise exception using errcode = 'P0001', message = 'Episode PV daily limit exceeded';
  end if;

  insert into public.episode_pv_events (
    viewer_key_hash,
    episode_id_snapshot,
    novel_id_snapshot,
    counted_at
  ) values (
    v_viewer_key_hash,
    v_episode_id,
    v_novel_id,
    v_now
  );

  update public.episodes
     set pv = coalesce(pv, 0) + 1
   where id::text = v_episode_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'PV episode disappeared during authoritative count';
  end if;

  update public.novels
     set pv = coalesce(pv, 0) + 1
   where id::text = v_novel_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'PV work disappeared during authoritative count';
  end if;

  return true;
end
$$;

create or replace function public.record_neutral_search_impressions(
  p_novel_ids text[],
  p_visitor_token text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := pg_catalog.btrim(coalesce(p_visitor_token, ''));
  v_key text;
  v_now timestamptz := pg_catalog.now();
  v_hour timestamptz := pg_catalog.date_trunc('hour', v_now);
  v_day_start timestamptz;
  v_pending integer;
  v_inserted integer;
begin
  if p_novel_ids is null
     or pg_catalog.cardinality(p_novel_ids) < 1
     or pg_catalog.cardinality(p_novel_ids) > 50 then
    raise exception using errcode = '22023', message = 'Search impression batch must contain between 1 and 50 works';
  end if;

  if v_uid is not null then
    v_key := 'user:' || v_uid::text;
  elsif pg_catalog.char_length(v_token) between 8 and 128 then
    v_key := 'visitor:' || v_token;
  else
    raise exception using errcode = '22023', message = 'Anonymous telemetry requires a visitor token';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:neutral-search:' || v_key, 0)
  );

  select pg_catalog.count(*)::integer
    into v_pending
    from (
      select distinct n.id::text as novel_id
        from public.novels n
       where n.status = 'published'
         and n.id::text = any(p_novel_ids)
         and not exists (
           select 1
             from public.neutral_search_impression_telemetry t
            where t.viewer_key = v_key
              and t.novel_id_snapshot = n.id::text
              and t.exposure_hour = v_hour
         )
    ) pending;

  if v_pending = 0 then return 0; end if;

  if (
    select pg_catalog.count(*)
      from public.neutral_search_impression_telemetry t
     where t.viewer_key = v_key
       and t.exposed_at >= v_now - interval '1 hour'
  ) + v_pending > 200 then
    raise exception using errcode = 'P0001', message = 'Neutral search hourly limit exceeded';
  end if;

  v_day_start := pg_catalog.timezone(
    'Asia/Tokyo',
    pg_catalog.timezone('Asia/Tokyo', v_now)::date
  );

  if (
    select pg_catalog.count(*)
      from public.neutral_search_impression_telemetry t
     where t.viewer_key = v_key
       and t.exposed_at >= v_day_start
  ) + v_pending > 2000 then
    raise exception using errcode = 'P0001', message = 'Neutral search daily limit exceeded';
  end if;

  insert into public.neutral_search_impression_telemetry (
    viewer_key,
    novel_id_snapshot,
    exposed_at,
    exposure_hour
  )
  select v_key, n.id::text, v_now, v_hour
    from public.novels n
   where n.status = 'published'
     and n.id::text = any(p_novel_ids)
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$$;

create table public.bulk_import_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  novel_id bigint not null references public.novels(id) on delete cascade,
  import_mode text not null,
  request_hash text not null,
  episode_count integer not null,
  body_char_count bigint not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint bulk_import_requests_mode_check
    check (import_mode in ('sequential', 'numbered')),
  constraint bulk_import_requests_hash_check
    check (pg_catalog.char_length(request_hash) = 64),
  constraint bulk_import_requests_episode_count_check
    check (episode_count between 1 and 200),
  constraint bulk_import_requests_body_char_count_check
    check (body_char_count between 1 and 5000000)
);

alter table public.bulk_import_requests enable row level security;

revoke all on table public.bulk_import_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.bulk_import_requests to service_role;

create index bulk_import_requests_user_created_idx
  on public.bulk_import_requests (user_id, created_at desc);

create index bulk_import_requests_novel_created_idx
  on public.bulk_import_requests (novel_id, created_at desc);

create index bulk_import_requests_dedupe_idx
  on public.bulk_import_requests (
    user_id,
    novel_id,
    import_mode,
    request_hash,
    created_at desc
  );

create index bulk_import_events_dedupe_idx
  on public.bulk_import_events (
    user_id,
    event_name,
    novel_id,
    episode_count,
    created_at desc
  );

create function private.novelight_reserve_bulk_import(
  p_user_id uuid,
  p_novel_id bigint,
  p_import_mode text,
  p_request_hash text,
  p_episode_count integer,
  p_body_char_count bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_day_start timestamptz;
  v_recent_count integer;
  v_daily_count integer;
  v_daily_episode_count bigint;
  v_daily_body_chars bigint;
  v_draft_count bigint;
begin
  if p_user_id is null
     or p_novel_id is null
     or p_import_mode not in ('sequential', 'numbered')
     or pg_catalog.char_length(coalesce(p_request_hash, '')) <> 64
     or p_episode_count not between 1 and 200
     or p_body_char_count not between 1 and 5000000 then
    raise exception 'Invalid bulk import reservation' using errcode = '22023';
  end if;

  -- Serialize all imports for one account, including imports into different
  -- novels. This makes the rolling and daily quotas race-safe.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'novelight:bulk-import:user:' || p_user_id::text,
      0
    )
  );

  select n.user_id
    into v_owner_id
    from public.novels n
   where n.id = p_novel_id
   for update;

  if not found or v_owner_id <> p_user_id then
    raise exception 'Novel not found or not owned by current user'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.bulk_import_requests r
     where r.user_id = p_user_id
       and r.novel_id = p_novel_id
       and r.import_mode = p_import_mode
       and r.request_hash = p_request_hash
       and r.created_at >= v_now - interval '24 hours'
  ) then
    raise exception 'Identical bulk import was already accepted in the last 24 hours'
      using errcode = '23505';
  end if;

  select pg_catalog.count(*)::integer
    into v_recent_count
    from public.bulk_import_requests r
   where r.user_id = p_user_id
     and r.created_at >= v_now - interval '10 minutes';

  if v_recent_count >= 5 then
    raise exception 'Bulk import rate limit exceeded'
      using errcode = 'P0001';
  end if;

  v_day_start := pg_catalog.timezone(
    'Asia/Tokyo',
    pg_catalog.timezone('Asia/Tokyo', v_now)::date
  );

  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(r.episode_count), 0),
    coalesce(pg_catalog.sum(r.body_char_count), 0)
  into v_daily_count, v_daily_episode_count, v_daily_body_chars
  from public.bulk_import_requests r
  where r.user_id = p_user_id
    and r.created_at >= v_day_start;

  if v_daily_count >= 20 then
    raise exception 'Daily bulk import request limit exceeded'
      using errcode = 'P0001';
  end if;

  if v_daily_episode_count + p_episode_count > 1000 then
    raise exception 'Daily bulk import episode limit exceeded'
      using errcode = 'P0001';
  end if;

  if v_daily_body_chars + p_body_char_count > 20000000 then
    raise exception 'Daily bulk import character limit exceeded'
      using errcode = 'P0001';
  end if;

  select pg_catalog.count(*)
    into v_draft_count
    from public.episodes e
   where e.novel_id = p_novel_id
     and e.status = 'draft';

  if v_draft_count + p_episode_count > 2000 then
    raise exception 'Novel draft episode limit exceeded'
      using errcode = '23514';
  end if;

  insert into public.bulk_import_requests (
    user_id,
    novel_id,
    import_mode,
    request_hash,
    episode_count,
    body_char_count,
    created_at
  ) values (
    p_user_id,
    p_novel_id,
    p_import_mode,
    p_request_hash,
    p_episode_count,
    p_body_char_count,
    v_now
  );
end
$$;

revoke all on function private.novelight_reserve_bulk_import(
  uuid, bigint, text, text, integer, bigint
) from public, anon, authenticated, service_role;

create or replace function public.novelight_bulk_import_episode_drafts(
  p_novel_id bigint,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_item jsonb;
  v_key text;
  v_title text;
  v_content text;
  v_start_number bigint;
  v_count integer;
  v_body_char_count bigint := 0;
  v_request_hash text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_novel_id is null then
    raise exception 'Novel is required' using errcode = '22023';
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'Import items must be a JSON array' using errcode = '22023';
  end if;

  if pg_catalog.octet_length(pg_catalog.convert_to(p_items::text, 'UTF8')) > 20000000 then
    raise exception 'Import payload must be at most 20000000 bytes' using errcode = '22023';
  end if;

  v_count := pg_catalog.jsonb_array_length(p_items);
  if v_count < 1 or v_count > 100 then
    raise exception 'Import must contain between 1 and 100 episodes' using errcode = '22023';
  end if;

  for v_item in
    select value
      from pg_catalog.jsonb_array_elements(p_items)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each import item must be an object' using errcode = '22023';
    end if;

    for v_key in
      select k
        from pg_catalog.jsonb_object_keys(v_item) as keys(k)
    loop
      if v_key not in ('title', 'content') then
        raise exception 'Unexpected import item field: %', v_key using errcode = '22023';
      end if;
    end loop;

    v_title := coalesce(v_item ->> 'title', '');
    v_content := coalesce(v_item ->> 'content', '');

    if pg_catalog.char_length(v_title) > 150 then
      raise exception 'Each imported title must be at most 150 characters' using errcode = '22023';
    end if;

    if pg_catalog.char_length(pg_catalog.btrim(v_content)) < 1
       or pg_catalog.char_length(v_content) > 100000 then
      raise exception 'Each imported body must contain 1 to 100000 characters' using errcode = '22023';
    end if;

    v_body_char_count := v_body_char_count + pg_catalog.char_length(v_content);
    if v_body_char_count > 5000000 then
      raise exception 'Import bodies must total at most 5000000 characters' using errcode = '22023';
    end if;
  end loop;

  v_request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('sequential:' || p_items::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform private.novelight_reserve_bulk_import(
    v_user_id,
    p_novel_id,
    'sequential',
    v_request_hash,
    v_count,
    v_body_char_count
  );

  select coalesce(pg_catalog.max(e.episode_number), 0) + 1
    into v_start_number
    from public.episodes e
   where e.novel_id = p_novel_id;

  insert into public.episodes (
    novel_id,
    user_id,
    episode_number,
    title,
    content,
    status,
    pv
  )
  select
    p_novel_id,
    v_user_id,
    v_start_number + item.ordinality - 1,
    coalesce(item.value ->> 'title', ''),
    item.value ->> 'content',
    'draft',
    0
  from pg_catalog.jsonb_array_elements(p_items)
    with ordinality as item(value, ordinality)
  order by item.ordinality;

  return v_count;
end
$$;

create or replace function public.novelight_import_episode_drafts(
  p_novel_id bigint,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_item jsonb;
  v_key text;
  v_episode_number bigint;
  v_title text;
  v_content text;
  v_count integer;
  v_body_char_count bigint := 0;
  v_request_hash text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_novel_id is null then
    raise exception 'Novel is required' using errcode = '22023';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'Import items must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.octet_length(pg_catalog.convert_to(p_items::text, 'UTF8')) > 20000000 then
    raise exception 'Import payload must be at most 20000000 bytes' using errcode = '22023';
  end if;

  v_count := pg_catalog.jsonb_array_length(p_items);
  if v_count < 1 or v_count > 200 then
    raise exception 'Import must contain between 1 and 200 episodes' using errcode = '22023';
  end if;

  for v_item in
    select value
      from pg_catalog.jsonb_array_elements(p_items)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each import item must be an object' using errcode = '22023';
    end if;

    for v_key in
      select k
        from pg_catalog.jsonb_object_keys(v_item) as keys(k)
    loop
      if v_key not in ('episode_number', 'title', 'content') then
        raise exception 'Unexpected import item field: %', v_key using errcode = '22023';
      end if;
    end loop;

    if coalesce(v_item ->> 'episode_number', '') !~ '^[0-9]+$' then
      raise exception 'Each episode_number must be a positive integer' using errcode = '22023';
    end if;

    v_episode_number := (v_item ->> 'episode_number')::bigint;
    v_title := coalesce(v_item ->> 'title', '');
    v_content := coalesce(v_item ->> 'content', '');

    if v_episode_number < 1 then
      raise exception 'Each episode_number must be at least 1' using errcode = '22023';
    end if;
    if pg_catalog.char_length(pg_catalog.btrim(v_title)) < 1
       or pg_catalog.char_length(v_title) > 150 then
      raise exception 'Each imported title must contain 1 to 150 characters' using errcode = '22023';
    end if;
    if pg_catalog.char_length(pg_catalog.btrim(v_content)) < 1
       or pg_catalog.char_length(v_content) > 100000 then
      raise exception 'Each imported body must contain 1 to 100000 characters' using errcode = '22023';
    end if;

    v_body_char_count := v_body_char_count + pg_catalog.char_length(v_content);
    if v_body_char_count > 5000000 then
      raise exception 'Import bodies must total at most 5000000 characters' using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_items) item
     group by (item ->> 'episode_number')::bigint
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'Import contains duplicate episode numbers' using errcode = '23505';
  end if;

  v_request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('numbered:' || p_items::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform private.novelight_reserve_bulk_import(
    v_user_id,
    p_novel_id,
    'numbered',
    v_request_hash,
    v_count,
    v_body_char_count
  );

  if exists (
    select 1
      from public.episodes e
      join pg_catalog.jsonb_array_elements(p_items) item
        on e.episode_number = (item ->> 'episode_number')::bigint
     where e.novel_id = p_novel_id
  ) then
    raise exception 'One or more imported episode numbers already exist in this novel'
      using errcode = '23505';
  end if;

  insert into public.episodes (
    novel_id,
    user_id,
    episode_number,
    title,
    content,
    status,
    pv
  )
  select
    p_novel_id,
    v_user_id,
    (item.value ->> 'episode_number')::bigint,
    item.value ->> 'title',
    item.value ->> 'content',
    'draft',
    0
  from pg_catalog.jsonb_array_elements(p_items) as item(value);

  return v_count;
end
$$;

create or replace function public.novelight_record_bulk_import_event(
  p_event text,
  p_novel_id bigint default null,
  p_episode_count integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_event text := coalesce(p_event, '');
  v_count integer := coalesce(p_episode_count, 0);
  v_now timestamptz := pg_catalog.now();
  v_day_start timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_event not in (
    'bulk_import_opened',
    'bulk_import_started',
    'bulk_import_parsed',
    'bulk_import_parse_failed',
    'bulk_import_confirmed',
    'bulk_import_completed'
  ) then
    raise exception 'Unsupported bulk import event' using errcode = '22023';
  end if;

  if v_count < 0 or v_count > 100 then
    raise exception 'Episode count must be between 0 and 100' using errcode = '22023';
  end if;

  if p_novel_id is not null and not exists (
    select 1
      from public.novels n
     where n.id = p_novel_id
       and n.user_id = v_user_id
  ) then
    raise exception 'Novel not found or not owned by current user' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'novelight:bulk-import-event:user:' || v_user_id::text,
      0
    )
  );

  if exists (
    select 1
      from public.bulk_import_events e
     where e.user_id = v_user_id
       and e.novel_id is not distinct from p_novel_id
       and e.event_name = v_event
       and e.episode_count = v_count
       and e.created_at >= v_now - interval '5 minutes'
  ) then
    return;
  end if;

  if (
    select pg_catalog.count(*)
      from public.bulk_import_events e
     where e.user_id = v_user_id
       and e.created_at >= v_now - interval '10 minutes'
  ) >= 30 then
    raise exception 'Bulk import analytics rate limit exceeded'
      using errcode = 'P0001';
  end if;

  v_day_start := pg_catalog.timezone(
    'Asia/Tokyo',
    pg_catalog.timezone('Asia/Tokyo', v_now)::date
  );

  if (
    select pg_catalog.count(*)
      from public.bulk_import_events e
     where e.user_id = v_user_id
       and e.created_at >= v_day_start
  ) >= 200 then
    raise exception 'Daily bulk import analytics limit exceeded'
      using errcode = 'P0001';
  end if;

  insert into public.bulk_import_events (
    user_id,
    novel_id,
    event_name,
    episode_count,
    created_at
  ) values (
    v_user_id,
    p_novel_id,
    v_event,
    v_count,
    v_now
  );
end
$$;

create or replace function public.novelight_record_scout_record_visit()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.now();
  v_date date := pg_catalog.timezone('Asia/Tokyo', v_now)::date;
  v_last_seen timestamptz;
  v_visit_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'novelight:scout-record-visit:user:' || v_uid::text,
      0
    )
  );

  select d.last_seen_at, d.visit_count
    into v_last_seen, v_visit_count
    from public.scout_record_usage_days d
   where d.user_id = v_uid
     and d.activity_date = v_date
   for update;

  if not found then
    insert into public.scout_record_usage_days (
      user_id, activity_date, first_seen_at, last_seen_at, visit_count
    ) values (
      v_uid, v_date, v_now, v_now, 1
    );
    return true;
  end if;

  if v_last_seen >= v_now - interval '10 minutes'
     or v_visit_count >= 48 then
    return false;
  end if;

  update public.scout_record_usage_days
     set last_seen_at = v_now,
         visit_count = visit_count + 1
   where user_id = v_uid
     and activity_date = v_date;

  return true;
end
$$;

create or replace function public.record_beta_visit(
  p_visitor_token text,
  p_path text default '/',
  p_source text default 'direct'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := pg_catalog.btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_now timestamptz := pg_catalog.now();
  v_date date := pg_catalog.timezone('Asia/Tokyo', v_now)::date;
  v_path text := coalesce(nullif(pg_catalog.btrim(coalesce(p_path, '')), ''), '/');
  v_source text := pg_catalog.lower(
    coalesce(nullif(pg_catalog.btrim(coalesce(p_source, '')), ''), 'direct')
  );
  v_last_seen timestamptz;
  v_visit_count integer;
  v_recorded boolean := false;
begin
  if pg_catalog.char_length(v_path) > 500
     or pg_catalog.char_length(v_source) > 40 then
    raise exception using errcode = '22023', message = 'Visit metadata is too long';
  end if;

  if v_uid is not null then
    v_hash := pg_catalog.md5('user:' || v_uid::text);
  else
    if pg_catalog.char_length(v_token) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'Visitor token is invalid';
    end if;
    v_hash := pg_catalog.md5('visitor:' || v_token);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:beta-visit:' || v_hash, 0)
  );

  select d.last_seen_at, d.visit_count
    into v_last_seen, v_visit_count
    from public.beta_activity_days d
   where d.viewer_key_hash = v_hash
     and d.activity_date = v_date
   for update;

  if not found then
    insert into public.beta_activity_days (
      viewer_key_hash,
      user_id,
      activity_date,
      first_seen_at,
      last_seen_at,
      visit_count,
      first_path,
      latest_path,
      source
    ) values (
      v_hash,
      v_uid,
      v_date,
      v_now,
      v_now,
      1,
      v_path,
      v_path,
      v_source
    );
    v_recorded := true;
  elsif v_last_seen < v_now - interval '10 minutes'
        and v_visit_count < 48 then
    update public.beta_activity_days
       set last_seen_at = v_now,
           visit_count = visit_count + 1,
           latest_path = v_path,
           user_id = coalesce(user_id, v_uid),
           source = case when source = 'direct' then v_source else source end
     where viewer_key_hash = v_hash
       and activity_date = v_date;
    v_recorded := true;
  end if;

  -- Attribution claiming must not be skipped merely because this page-view was
  -- deduplicated; login can occur inside the dedupe window.
  if v_uid is not null and pg_catalog.char_length(v_token) between 8 and 200 then
    perform public.claim_user_acquisition(v_token);
  end if;

  return v_recorded;
end
$$;

create or replace function public.record_acquisition_touch(
  p_visitor_token text,
  p_source text,
  p_medium text default null,
  p_campaign text default null,
  p_content text default null,
  p_landing_path text default '/',
  p_referrer_host text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := pg_catalog.btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_source text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(nullif(p_source, ''), 'direct'))
  );
  v_medium text := nullif(pg_catalog.btrim(coalesce(p_medium, '')), '');
  v_campaign text := nullif(pg_catalog.btrim(coalesce(p_campaign, '')), '');
  v_content text := nullif(pg_catalog.btrim(coalesce(p_content, '')), '');
  v_landing_path text := coalesce(
    nullif(pg_catalog.btrim(coalesce(p_landing_path, '')), ''),
    '/'
  );
  v_referrer_host text := nullif(
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_referrer_host, ''))),
    ''
  );
  v_now timestamptz := pg_catalog.now();
  v_day_start timestamptz;
  v_id uuid;
begin
  if pg_catalog.char_length(v_token) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'Visitor token is invalid';
  end if;

  if pg_catalog.char_length(v_source) > 40
     or pg_catalog.char_length(coalesce(v_medium, '')) > 80
     or pg_catalog.char_length(coalesce(v_campaign, '')) > 120
     or pg_catalog.char_length(coalesce(v_content, '')) > 120
     or pg_catalog.char_length(v_landing_path) > 500
     or pg_catalog.char_length(coalesce(v_referrer_host, '')) > 255 then
    raise exception using errcode = '22023', message = 'Acquisition metadata is too long';
  end if;

  v_hash := pg_catalog.md5(v_token);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:acquisition-touch:' || v_hash, 0)
  );

  select t.id
    into v_id
    from public.acquisition_touches t
   where t.visitor_key_hash = v_hash
     and t.source = v_source
     and t.medium is not distinct from v_medium
     and t.campaign is not distinct from v_campaign
     and t.content is not distinct from v_content
     and t.landing_path = v_landing_path
     and t.referrer_host is not distinct from v_referrer_host
     and t.touched_at >= v_now - interval '30 minutes'
   order by t.touched_at desc, t.id desc
   limit 1;

  if found then
    return v_id;
  end if;

  if (
    select pg_catalog.count(*)
      from public.acquisition_touches t
     where t.visitor_key_hash = v_hash
       and t.touched_at >= v_now - interval '1 hour'
  ) >= 10 then
    raise exception using errcode = 'P0001', message = 'Too many acquisition events';
  end if;

  v_day_start := pg_catalog.timezone(
    'Asia/Tokyo',
    pg_catalog.timezone('Asia/Tokyo', v_now)::date
  );

  if (
    select pg_catalog.count(*)
      from public.acquisition_touches t
     where t.visitor_key_hash = v_hash
       and t.touched_at >= v_day_start
  ) >= 50 then
    raise exception using errcode = 'P0001', message = 'Daily acquisition event limit exceeded';
  end if;

  insert into public.acquisition_touches (
    visitor_key_hash,
    user_id,
    source,
    medium,
    campaign,
    content,
    landing_path,
    referrer_host,
    touched_at
  ) values (
    v_hash,
    v_uid,
    v_source,
    v_medium,
    v_campaign,
    v_content,
    v_landing_path,
    v_referrer_host,
    v_now
  )
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.novelight_bulk_import_episode_drafts(bigint,jsonb)
  from public, anon;
grant execute on function public.novelight_bulk_import_episode_drafts(bigint,jsonb)
  to authenticated;

revoke all on function public.novelight_import_episode_drafts(bigint,jsonb)
  from public, anon;
grant execute on function public.novelight_import_episode_drafts(bigint,jsonb)
  to authenticated;

revoke all on function public.novelight_record_bulk_import_event(text,bigint,integer)
  from public, anon;
grant execute on function public.novelight_record_bulk_import_event(text,bigint,integer)
  to authenticated;

revoke all on function public.novelight_record_scout_record_visit()
  from public, anon;
grant execute on function public.novelight_record_scout_record_visit()
  to authenticated;

revoke all on function public.record_beta_visit(text,text,text)
  from public, anon;
grant execute on function public.record_beta_visit(text,text,text)
  to authenticated, service_role;

revoke all on function public.record_acquisition_touch(text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_acquisition_touch(text,text,text,text,text,text,text)
  to service_role;

revoke all on function public.record_reader_journey_event(text,text,text,text,text)
  from public, anon;
grant execute on function public.record_reader_journey_event(text,text,text,text,text)
  to authenticated, service_role;

revoke all on function public.record_episode_pv(text,text)
  from public, anon;
grant execute on function public.record_episode_pv(text,text)
  to authenticated, service_role;

revoke all on function public.record_neutral_search_impressions(text[],text)
  from public, anon;
grant execute on function public.record_neutral_search_impressions(text[],text)
  to authenticated, service_role;

comment on table public.bulk_import_requests is
  'Private AUDIT-004 reservation and audit ledger. Stores bounded request metadata and a SHA-256 payload fingerprint, never episode content.';

comment on function private.novelight_reserve_bulk_import(
  uuid, bigint, text, text, integer, bigint
) is
  'Internal race-safe AUDIT-004 quota reservation. Not executable by client or service roles.';

comment on function public.record_beta_visit(text,text,text) is
  'AUDIT-005 visit recorder. Anonymous callers must use the same-origin server analytics boundary; authenticated callers remain bound to auth.uid().';

comment on function public.record_acquisition_touch(text,text,text,text,text,text,text) is
  'AUDIT-005 service-role-only acquisition recorder. The server supplies an HMAC fingerprint derived from Vercel-verified client IP evidence.';

comment on function public.record_reader_journey_event(text,text,text,text,text) is
  'AUDIT-005 reader journey recorder. Anonymous calls use the same-origin server fingerprint; authenticated identity is derived from auth.uid().';

comment on function public.record_episode_pv(text,text) is
  'AUDIT-005 authoritative PV recorder with six-hour dedupe and hourly/daily growth limits. Anonymous calls use the server boundary.';

comment on function public.record_neutral_search_impressions(text[],text) is
  'AUDIT-005 neutral-search telemetry with hourly dedupe, bounded batches, and hourly/daily growth limits. Anonymous calls use the server boundary.';

commit;
