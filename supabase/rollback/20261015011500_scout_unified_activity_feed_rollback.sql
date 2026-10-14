-- Safety rollback for the unified SCOUT activity.
-- Restore existing journey telemetry validation and preserve historical activity.
-- Do NOT drop the widened event_type check: existing x_share_open rows must remain valid.
begin;

drop function if exists
  public.novelight_scout_activity_feed(text,integer,integer);

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
$function$;

commit;
