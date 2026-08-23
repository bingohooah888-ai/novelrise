-- NOVELIGHT exposure funnel: per-episode retention and attributed favorites.
-- Preserve the existing exposure attribution model while allowing multiple
-- meaningful episode reads from the same exposure.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823133000'));

alter table public.novel_exposure_conversions
  add column episode_number_snapshot integer;

update public.novel_exposure_conversions c
set episode_number_snapshot = e.episode_number
from public.episodes e
where c.event_type = 'episode_read_10s'
  and c.episode_id_snapshot is not null
  and e.id::text = c.episode_id_snapshot;

alter table public.novel_exposure_conversions
  drop constraint novel_exposure_conversion_once;

alter table public.novel_exposure_conversions
  drop constraint novel_exposure_conversions_event_type_check;

alter table public.novel_exposure_conversions
  drop constraint novel_exposure_episode_requirement;

alter table public.novel_exposure_conversions
  add constraint novel_exposure_conversions_event_type_check
  check (event_type in ('detail_open', 'episode_read_10s', 'favorite_added'));

alter table public.novel_exposure_conversions
  add constraint novel_exposure_episode_requirement
  check (
    (event_type in ('detail_open', 'favorite_added') and episode_id_snapshot is null)
    or (event_type = 'episode_read_10s' and episode_id_snapshot is not null)
  );

alter table public.novel_exposure_conversions
  add constraint novel_exposure_conversion_episode_number_check
  check (episode_number_snapshot is null or episode_number_snapshot > 0);

create unique index novel_exposure_conversion_detail_once_idx
  on public.novel_exposure_conversions (exposure_id)
  where event_type = 'detail_open';

create unique index novel_exposure_conversion_favorite_once_idx
  on public.novel_exposure_conversions (exposure_id)
  where event_type = 'favorite_added';

create unique index novel_exposure_conversion_episode_once_idx
  on public.novel_exposure_conversions (exposure_id, episode_id_snapshot)
  where event_type = 'episode_read_10s';

create or replace function public.record_novel_exposure_conversion(
  p_event_type text,
  p_novel_id text,
  p_episode_id text default null,
  p_visitor_token text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_viewer_key text;
  v_author_id uuid;
  v_exposure_id uuid;
  v_episode_number integer;
  v_inserted integer := 0;
begin
  if p_event_type not in ('detail_open', 'episode_read_10s', 'favorite_added') then
    raise exception using
      errcode = '22023',
      message = 'Unsupported exposure conversion event';
  end if;

  if p_novel_id is null or btrim(p_novel_id) = '' then
    raise exception using
      errcode = '22023',
      message = 'A novel identifier is required';
  end if;

  if p_event_type in ('detail_open', 'favorite_added') and p_episode_id is not null then
    raise exception using
      errcode = '22023',
      message = p_event_type || ' must not include an episode identifier';
  end if;

  if p_event_type = 'episode_read_10s'
     and (p_episode_id is null or btrim(p_episode_id) = '') then
    raise exception using
      errcode = '22023',
      message = 'episode_read_10s requires an episode identifier';
  end if;

  -- Favorites are authenticated actions. Anonymous callers cannot create a
  -- favorite conversion even if they know a visitor token.
  if p_event_type = 'favorite_added' and v_uid is null then
    return false;
  end if;

  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  else
    if p_visitor_token is null
       or length(btrim(p_visitor_token)) < 8
       or length(btrim(p_visitor_token)) > 128 then
      raise exception using
        errcode = '22023',
        message = 'Anonymous conversion attribution requires a visitor token';
    end if;

    v_viewer_key := 'visitor:' || btrim(p_visitor_token);
  end if;

  select n.user_id
  into v_author_id
  from public.novels n
  where n.id::text = p_novel_id
    and n.status = 'published';

  if not found then
    return false;
  end if;

  -- Never count an author's own browsing or favorite action as discovery success.
  if v_uid is not null and v_uid = v_author_id then
    return false;
  end if;

  if p_event_type = 'episode_read_10s' then
    select e.episode_number
    into v_episode_number
    from public.episodes e
    where e.id::text = p_episode_id
      and e.novel_id::text = p_novel_id
      and e.status = 'published';

    if not found then
      raise exception using
        errcode = '23514',
        message = 'The episode is not a published episode of this work';
    end if;
  end if;

  -- Do not trust a client-only favorite event. The authenticated user must
  -- actually have the favorite row at the time this RPC is called.
  if p_event_type = 'favorite_added' and not exists (
    select 1
    from public.favorites f
    where f.user_id = v_uid
      and f.novel_id::text = p_novel_id
  ) then
    return false;
  end if;

  -- Attribute to the latest real impression for this viewer/work in the
  -- previous 24 hours. Direct URL traffic has no matching exposure.
  select e.id
  into v_exposure_id
  from public.novel_exposure_events e
  where e.viewer_key = v_viewer_key
    and e.novel_id_snapshot = p_novel_id
    and e.exposed_at >= now() - interval '24 hours'
  order by e.exposed_at desc, e.id desc
  limit 1;

  if v_exposure_id is null then
    return false;
  end if;

  insert into public.novel_exposure_conversions (
    exposure_id,
    viewer_key_snapshot,
    novel_id_snapshot,
    author_id_snapshot,
    event_type,
    episode_id_snapshot,
    episode_number_snapshot,
    converted_at
  ) values (
    v_exposure_id,
    v_viewer_key,
    p_novel_id,
    v_author_id,
    p_event_type,
    case when p_event_type = 'episode_read_10s' then p_episode_id else null end,
    case when p_event_type = 'episode_read_10s' then v_episode_number else null end,
    now()
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end
$$;

revoke all on function public.record_novel_exposure_conversion(text, text, text, text) from public;
grant execute on function public.record_novel_exposure_conversion(text, text, text, text) to anon, authenticated;

drop function public.novelight_author_exposure_funnel(integer);

create function public.novelight_author_exposure_funnel(
  p_days integer default 30
)
returns table (
  novel_id text,
  title text,
  impressions bigint,
  detail_opens bigint,
  body_reads_10s bigint,
  detail_rate_pct numeric,
  body_read_rate_pct numeric,
  first_episode_reads_10s bigint,
  continued_to_episode_2 bigint,
  episode1_to_episode2_rate_pct numeric,
  favorites bigint,
  favorite_rate_pct numeric,
  premium_slot_impressions bigint,
  premium_slot_detail_opens bigint,
  premium_slot_body_reads_10s bigint,
  premium_slot_body_read_rate_pct numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'Author funnel analytics require authentication';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception using
      errcode = '22023',
      message = 'Analytics window must be between 1 and 90 days';
  end if;

  return query
  with owned_exposures as materialized (
    select e.*
    from public.novel_exposure_events e
    where e.author_id_snapshot = v_uid
      and e.exposed_at >= now() - make_interval(days => p_days)
  ),
  conversion_flags as (
    select
      c.exposure_id,
      bool_or(c.event_type = 'detail_open') as detail_open,
      bool_or(c.event_type = 'episode_read_10s') as body_read,
      bool_or(
        c.event_type = 'episode_read_10s'
        and coalesce(c.episode_number_snapshot, ep.episode_number) = 1
      ) as episode_1_read,
      bool_or(
        c.event_type = 'episode_read_10s'
        and coalesce(c.episode_number_snapshot, ep.episode_number) = 2
      ) as episode_2_read,
      bool_or(c.event_type = 'favorite_added') as favorite_added
    from public.novel_exposure_conversions c
    left join public.episodes ep
      on ep.id::text = c.episode_id_snapshot
    where exists (
      select 1
      from owned_exposures oe
      where oe.id = c.exposure_id
    )
    group by c.exposure_id
  ),
  aggregate_rows as (
    select
      e.novel_id_snapshot,
      count(*)::bigint as impressions,
      count(*) filter (where coalesce(f.detail_open, false))::bigint as detail_opens,
      count(*) filter (where coalesce(f.body_read, false))::bigint as body_reads,
      count(*) filter (where coalesce(f.episode_1_read, false))::bigint as first_episode_reads,
      count(*) filter (
        where coalesce(f.episode_1_read, false)
          and coalesce(f.episode_2_read, false)
      )::bigint as continued_to_episode_2,
      count(*) filter (where coalesce(f.favorite_added, false))::bigint as favorites,
      count(*) filter (where e.surface = 'home_premium_slot')::bigint as premium_impressions,
      count(*) filter (
        where e.surface = 'home_premium_slot'
          and coalesce(f.detail_open, false)
      )::bigint as premium_details,
      count(*) filter (
        where e.surface = 'home_premium_slot'
          and coalesce(f.body_read, false)
      )::bigint as premium_reads
    from owned_exposures e
    left join conversion_flags f on f.exposure_id = e.id
    group by e.novel_id_snapshot
  )
  select
    a.novel_id_snapshot as novel_id,
    coalesce(n.title, '削除済み作品')::text as title,
    a.impressions,
    a.detail_opens,
    a.body_reads,
    round(100.0 * a.detail_opens / nullif(a.impressions, 0), 2) as detail_rate_pct,
    round(100.0 * a.body_reads / nullif(a.impressions, 0), 2) as body_read_rate_pct,
    a.first_episode_reads,
    a.continued_to_episode_2,
    round(
      100.0 * a.continued_to_episode_2 / nullif(a.first_episode_reads, 0),
      2
    ) as episode1_to_episode2_rate_pct,
    a.favorites,
    round(100.0 * a.favorites / nullif(a.impressions, 0), 2) as favorite_rate_pct,
    a.premium_impressions,
    a.premium_details,
    a.premium_reads,
    round(100.0 * a.premium_reads / nullif(a.premium_impressions, 0), 2)
      as premium_slot_body_read_rate_pct
  from aggregate_rows a
  left join public.novels n
    on n.id::text = a.novel_id_snapshot
    and n.user_id = v_uid
  order by a.impressions desc, a.novel_id_snapshot;
end
$$;

revoke all on function public.novelight_author_exposure_funnel(integer) from public, anon;
grant execute on function public.novelight_author_exposure_funnel(integer) to authenticated;

commit;
