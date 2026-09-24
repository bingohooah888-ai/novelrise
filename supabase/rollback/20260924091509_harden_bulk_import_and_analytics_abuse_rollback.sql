-- Rollback for 20260924091509_harden_bulk_import_and_analytics_abuse.sql
--
-- The new request ledger is security evidence. Refuse to discard it after real
-- use; export/preserve those rows before an operator retries this rollback.

begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20260924091509:rollback')
);

do $$
begin
  if to_regclass('public.bulk_import_requests') is not null
     and exists (select 1 from public.bulk_import_requests limit 1) then
    raise exception 'bulk_import_requests contains audit data; preserve it before rollback';
  end if;
end
$$;

create or replace function public.novelight_bulk_import_episode_drafts(
  p_novel_id bigint,
  p_items jsonb
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_key text;
  v_title text;
  v_content text;
  v_start_number bigint;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_novel_id is null then
    raise exception 'Novel is required' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Import items must be a JSON array' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 100 then
    raise exception 'Import must contain between 1 and 100 episodes' using errcode = '22023';
  end if;

  perform 1
  from public.novels n
  where n.id = p_novel_id
    and n.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Novel not found or not owned by current user' using errcode = '42501';
  end if;

  select coalesce(max(e.episode_number), 0) + 1
  into v_start_number
  from public.episodes e
  where e.novel_id = p_novel_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each import item must be an object' using errcode = '22023';
    end if;

    for v_key in
      select k
      from jsonb_object_keys(v_item) as keys(k)
    loop
      if v_key not in ('title', 'content') then
        raise exception 'Unexpected import item field: %', v_key using errcode = '22023';
      end if;
    end loop;

    v_title := coalesce(v_item ->> 'title', '');
    v_content := coalesce(v_item ->> 'content', '');

    if char_length(v_title) > 150 then
      raise exception 'Each imported title must be at most 150 characters' using errcode = '22023';
    end if;

    if char_length(trim(v_content)) < 1 or char_length(v_content) > 100000 then
      raise exception 'Each imported body must contain 1 to 100000 characters' using errcode = '22023';
    end if;
  end loop;

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
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
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
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_episode_number bigint;
  v_title text;
  v_content text;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_novel_id is null then
    raise exception 'Novel is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Import items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then
    raise exception 'Import must contain between 1 and 200 episodes' using errcode = '22023';
  end if;

  perform 1
  from public.novels n
  where n.id = p_novel_id
    and n.user_id = v_user_id
  for update;
  if not found then
    raise exception 'Novel not found or not owned by current user' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each import item must be an object' using errcode = '22023';
    end if;
    if coalesce(v_item ->> 'episode_number', '') !~ '^[0-9]+$' then
      raise exception 'Each episode_number must be a positive integer' using errcode = '22023';
    end if;
    v_episode_number := (v_item ->> 'episode_number')::bigint;
    v_title := coalesce(v_item ->> 'title', '');
    v_content := coalesce(v_item ->> 'content', '');
    if v_episode_number < 1 then
      raise exception 'Each episode_number must be at least 1' using errcode = '22023';
    end if;
    if char_length(trim(v_title)) < 1 or char_length(v_title) > 150 then
      raise exception 'Each imported title must contain 1 to 150 characters' using errcode = '22023';
    end if;
    if char_length(trim(v_content)) < 1 or char_length(v_content) > 100000 then
      raise exception 'Each imported body must contain 1 to 100000 characters' using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by (item ->> 'episode_number')::bigint
    having count(*) > 1
  ) then
    raise exception 'Import contains duplicate episode numbers' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.episodes e
    join jsonb_array_elements(p_items) item
      on e.episode_number = (item ->> 'episode_number')::bigint
    where e.novel_id = p_novel_id
  ) then
    raise exception 'One or more imported episode numbers already exist in this novel' using errcode = '23505';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.episodes (
      novel_id,
      user_id,
      episode_number,
      title,
      content,
      status,
      pv
    ) values (
      p_novel_id,
      v_user_id,
      (v_item ->> 'episode_number')::bigint,
      v_item ->> 'title',
      v_item ->> 'content',
      'draft',
      0
    );
    v_count := v_count + 1;
  end loop;

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
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event text := coalesce(p_event, '');
  v_count integer := coalesce(p_episode_count, 0);
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

  insert into public.bulk_import_events (
    user_id,
    novel_id,
    event_name,
    episode_count
  ) values (
    v_user_id,
    p_novel_id,
    v_event,
    v_count
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
  v_date date := pg_catalog.timezone('Asia/Tokyo', pg_catalog.now())::date;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  insert into public.scout_record_usage_days (
    user_id, activity_date, first_seen_at, last_seen_at, visit_count
  ) values (
    v_uid, v_date, pg_catalog.now(), pg_catalog.now(), 1
  )
  on conflict (user_id, activity_date) do update
    set last_seen_at = excluded.last_seen_at,
        visit_count = public.scout_record_usage_days.visit_count + 1;

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
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_date date := timezone('Asia/Tokyo', now())::date;
  v_path text := coalesce(nullif(btrim(coalesce(p_path, '')), ''), '/');
  v_source text := lower(coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'direct'));
begin
  if char_length(v_path) > 500 or char_length(v_source) > 40 then
    raise exception using errcode = '22023', message = 'Visit metadata is too long';
  end if;

  if v_uid is not null then
    v_hash := md5('user:' || v_uid::text);
  else
    if char_length(v_token) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'Visitor token is invalid';
    end if;
    v_hash := md5('visitor:' || v_token);
  end if;

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
    now(),
    now(),
    1,
    v_path,
    v_path,
    v_source
  )
  on conflict (viewer_key_hash, activity_date) do update
    set last_seen_at = excluded.last_seen_at,
        visit_count = public.beta_activity_days.visit_count + 1,
        latest_path = excluded.latest_path,
        user_id = coalesce(public.beta_activity_days.user_id, excluded.user_id),
        source = case
          when public.beta_activity_days.source = 'direct' then excluded.source
          else public.beta_activity_days.source
        end;

  if v_uid is not null and char_length(v_token) between 8 and 200 then
    perform public.claim_user_acquisition(v_token);
  end if;

  return true;
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
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_source text := lower(btrim(coalesce(nullif(p_source, ''), 'direct')));
  v_recent integer;
  v_id uuid;
begin
  if char_length(v_token) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'Visitor token is invalid';
  end if;

  if char_length(v_source) > 40
     or char_length(coalesce(p_medium, '')) > 80
     or char_length(coalesce(p_campaign, '')) > 120
     or char_length(coalesce(p_content, '')) > 120
     or char_length(coalesce(p_landing_path, '/')) > 500
     or char_length(coalesce(p_referrer_host, '')) > 255 then
    raise exception using errcode = '22023', message = 'Acquisition metadata is too long';
  end if;

  v_hash := md5(v_token);

  select count(*)::integer into v_recent
    from public.acquisition_touches t
   where t.visitor_key_hash = v_hash
     and t.touched_at >= now() - interval '10 minutes';

  if v_recent >= 20 then
    raise exception using errcode = 'P0001', message = 'Too many acquisition events';
  end if;

  insert into public.acquisition_touches (
    visitor_key_hash,
    user_id,
    source,
    medium,
    campaign,
    content,
    landing_path,
    referrer_host
  ) values (
    v_hash,
    v_uid,
    v_source,
    nullif(btrim(coalesce(p_medium, '')), ''),
    nullif(btrim(coalesce(p_campaign, '')), ''),
    nullif(btrim(coalesce(p_content, '')), ''),
    coalesce(nullif(btrim(coalesce(p_landing_path, '')), ''), '/'),
    nullif(lower(btrim(coalesce(p_referrer_host, ''))), '')
  )
  returning id into v_id;

  return v_id;
end
$$;

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
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_author_id uuid;
  v_source text := lower(coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'direct'));
  v_inserted integer := 0;
begin
  if p_event_type not in ('detail_open', 'episode_read_10s', 'favorite_added', 'light_seed') then
    raise exception using errcode = '22023', message = 'Unsupported journey event';
  end if;

  if char_length(v_source) > 40 then
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
    v_hash := md5('user:' || v_uid::text);
  else
    if char_length(v_token) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'Visitor token is invalid';
    end if;
    v_hash := md5('visitor:' || v_token);
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
    now(),
    date_trunc('hour', now())
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
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_episode_id text;
  v_novel_id text;
  v_author_id uuid;
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_viewer_key_hash text;
  v_rows integer;
begin
  if p_episode_id is null or btrim(p_episode_id) = '' then
    return false;
  end if;

  select e.id::text, e.novel_id::text, n.user_id
    into v_episode_id, v_novel_id, v_author_id
    from public.episodes e
    join public.novels n on n.id = e.novel_id
   where e.id::text = btrim(p_episode_id)
     and e.status = 'published'
     and n.status = 'published';

  if not found then return false; end if;
  if v_uid is not null and v_uid = v_author_id then return false; end if;

  if v_uid is not null then
    v_viewer_key_hash := md5('user:' || v_uid::text);
  else
    if char_length(v_token) not between 8 and 200 then
      raise exception using errcode = '22023', message = 'Visitor token is invalid';
    end if;
    v_viewer_key_hash := md5('visitor:' || v_token);
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_viewer_key_hash),
    hashtext(v_episode_id)
  );

  if exists (
    select 1
      from public.episode_pv_events p
     where p.viewer_key_hash = v_viewer_key_hash
       and p.episode_id_snapshot = v_episode_id
       and p.counted_at >= now() - interval '6 hours'
  ) then
    return false;
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
    now()
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
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text;
  v_inserted integer;
begin
  if p_novel_ids is null or cardinality(p_novel_ids) < 1 or cardinality(p_novel_ids) > 50 then
    raise exception using errcode = '22023', message = 'Search impression batch must contain between 1 and 50 works';
  end if;
  if v_uid is not null then v_key := 'user:' || v_uid::text;
  elsif p_visitor_token is not null and length(btrim(p_visitor_token)) between 8 and 128 then
    v_key := 'visitor:' || btrim(p_visitor_token);
  else raise exception using errcode = '22023', message = 'Anonymous telemetry requires a visitor token'; end if;
  insert into public.neutral_search_impression_telemetry (viewer_key, novel_id_snapshot, exposure_hour)
    select v_key, n.id::text, date_trunc('hour', now()) from public.novels n
    where n.status = 'published' and n.id::text = any(p_novel_ids)
    on conflict do nothing;
  get diagnostics v_inserted = row_count; return v_inserted;
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

revoke all on function public.record_beta_visit(text,text,text) from public;
grant execute on function public.record_beta_visit(text,text,text)
  to anon, authenticated, service_role;

revoke all on function public.record_acquisition_touch(text,text,text,text,text,text,text)
  from public;
grant execute on function public.record_acquisition_touch(text,text,text,text,text,text,text)
  to anon, authenticated, service_role;

revoke all on function public.record_reader_journey_event(text,text,text,text,text)
  from public;
grant execute on function public.record_reader_journey_event(text,text,text,text,text)
  to anon, authenticated, service_role;

revoke all on function public.record_episode_pv(text,text)
  from public;
grant execute on function public.record_episode_pv(text,text)
  to anon, authenticated, service_role;

revoke all on function public.record_neutral_search_impressions(text[],text)
  from public;
grant execute on function public.record_neutral_search_impressions(text[],text)
  to anon, authenticated, service_role;

comment on function public.record_beta_visit(text,text,text) is null;
comment on function public.record_acquisition_touch(text,text,text,text,text,text,text) is null;
comment on function public.record_reader_journey_event(text,text,text,text,text) is null;
comment on function public.record_episode_pv(text,text) is null;
comment on function public.record_neutral_search_impressions(text[],text) is null;

drop function if exists private.novelight_reserve_bulk_import(
  uuid, bigint, text, text, integer, bigint
);
drop table if exists public.bulk_import_requests;
drop index if exists public.bulk_import_events_dedupe_idx;

commit;
