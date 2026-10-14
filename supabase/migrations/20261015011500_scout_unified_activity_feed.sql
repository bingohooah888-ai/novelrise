-- Unified, private SCOUT activity feed. Only real recorded actions are shown.
-- Future X intent openings are recorded; no past X posts are invented.
begin;

alter table public.reader_journey_events
  drop constraint reader_journey_events_event_type_check;
alter table public.reader_journey_events
  add constraint reader_journey_events_event_type_check
  check (event_type in ('detail_open', 'episode_read_10s', 'favorite_added', 'light_seed', 'x_share_open'));

CREATE OR REPLACE FUNCTION public.record_reader_journey_event(p_event_type text, p_novel_id text, p_episode_id text DEFAULT NULL::text, p_visitor_token text DEFAULT NULL::text, p_source text DEFAULT 'direct'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_event_type not in ('detail_open', 'episode_read_10s', 'favorite_added', 'light_seed', 'x_share_open') then
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

  if p_event_type = 'x_share_open' and v_uid is null then
    return false;
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
    (pg_catalog.timezone('Asia/Tokyo', v_now)::date)::timestamp without time zone
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
$function$

create or replace function public.novelight_scout_activity_feed(
  p_kind text default 'all',
  p_limit integer default 21,
  p_offset integer default 0
)
returns table (
  event_type text,
  novel_id text,
  novel_title text,
  occurred_at timestamp with time zone,
  seed_type text
)
language plpgsql
stable security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  if p_kind not in ('all', 'read', 'favorite', 'seed', 'share') then
    raise exception using errcode='22023', message='Unsupported SCOUT activity filter';
  end if;
  return query
  with activity as (
    select e.event_type, e.novel_id_snapshot as work_id,
           e.occurred_at as event_time, null::text as light_seed_type,
           e.id::text as event_id
      from public.scout_event_ledger e
     where e.user_id = (select auth.uid())
       and e.event_type in ('valid_read', 'comment_posted')
    union all
    select j.event_type, j.novel_id_snapshot, j.occurred_at, null::text, j.id::text
      from public.reader_journey_events j
     where j.user_id = (select auth.uid())
       and j.event_type in ('favorite_added', 'x_share_open')
    union all
    -- Older favorites remain visible even without reader-journey telemetry.
    select 'favorite_added'::text, f.novel_id::text, f.created_at, null::text,
           'favorite-' || f.id::text
      from public.favorites f
     where f.user_id = (select auth.uid())
       and not exists (
         select 1 from public.reader_journey_events j
          where j.user_id = f.user_id and j.event_type = 'favorite_added'
            and j.novel_id_snapshot = f.novel_id::text
       )
    union all
    -- Authoritative full LIGHT SEED history (not just the recent Scout ledger).
    select 'light_seed_sent'::text, s.novel_id_snapshot,
           s.seeded_at, s.seed_type, s.id::text
      from public.light_seeds s
     where s.reader_id = (select auth.uid())
  )
  select a.event_type, a.work_id,
         case when n.status = 'published' then n.title else null end,
         a.event_time, a.light_seed_type
    from activity a
    left join public.novels n on n.id::text = a.work_id
   where p_kind = 'all'
      or (p_kind = 'read' and a.event_type = 'valid_read')
      or (p_kind = 'favorite' and a.event_type = 'favorite_added')
      or (p_kind = 'seed' and a.event_type = 'light_seed_sent')
      or (p_kind = 'share' and a.event_type = 'x_share_open')
   order by a.event_time desc, a.event_id desc
   limit least(greatest(coalesce(p_limit, 21), 1), 50)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
end;
$function$;

revoke all on function public.novelight_scout_activity_feed(text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.novelight_scout_activity_feed(text,integer,integer)
  to authenticated;

commit;
