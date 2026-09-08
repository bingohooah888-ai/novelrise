-- Aggregate LIGHT ANALYTICS time series and prior-period comparison.
-- This endpoint intentionally exposes only the requesting author's all-work totals,
-- so Free can use visual trends without bypassing per-work plan entitlements.
-- Production application requires separate OWNER approval after merge.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260908172000'));

create function public.novelight_author_analytics_timeseries(
  p_days integer default 30
)
returns table (
  bucket_date date,
  impressions bigint,
  detail_opens bigint,
  first_episode_reads_10s bigint,
  continued_to_episode_2 bigint,
  favorites bigint,
  current_impressions bigint,
  current_detail_opens bigint,
  current_first_episode_reads_10s bigint,
  current_continued_to_episode_2 bigint,
  current_favorites bigint,
  previous_impressions bigint,
  previous_detail_opens bigint,
  previous_first_episode_reads_10s bigint,
  previous_continued_to_episode_2 bigint,
  previous_favorites bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'Author analytics trends require authentication';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception using
      errcode = '22023',
      message = 'Analytics trend window must be between 1 and 90 days';
  end if;

  return query
  with buckets as materialized (
    select
      series.bucket_index,
      v_now - make_interval(days => p_days - series.bucket_index) as bucket_start,
      v_now - make_interval(days => p_days - series.bucket_index - 1) as bucket_end
    from generate_series(0, p_days - 1) as series(bucket_index)
  ),
  owned_exposures as materialized (
    select e.*
      from public.novel_exposure_events e
     where e.author_id_snapshot = v_uid
       and e.exposed_at >= v_now - make_interval(days => p_days * 2)
       and e.exposed_at < v_now
  ),
  conversion_flags as materialized (
    select
      c.exposure_id,
      bool_or(c.event_type = 'detail_open') as detail_open,
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
    left join public.episodes ep on ep.id::text = c.episode_id_snapshot
    where exists (
      select 1
        from owned_exposures oe
       where oe.id = c.exposure_id
    )
    group by c.exposure_id
  ),
  daily as materialized (
    select
      b.bucket_index,
      b.bucket_end,
      count(e.id)::bigint as impressions,
      count(e.id) filter (where coalesce(f.detail_open, false))::bigint as detail_opens,
      count(e.id) filter (where coalesce(f.episode_1_read, false))::bigint as first_reads,
      count(e.id) filter (
        where coalesce(f.episode_1_read, false)
          and coalesce(f.episode_2_read, false)
      )::bigint as second_reads,
      count(e.id) filter (where coalesce(f.favorite_added, false))::bigint as favorites
    from buckets b
    left join owned_exposures e
      on e.exposed_at >= b.bucket_start
     and e.exposed_at < b.bucket_end
    left join conversion_flags f on f.exposure_id = e.id
    group by b.bucket_index, b.bucket_end
  ),
  totals as materialized (
    select
      count(e.id) filter (
        where e.exposed_at >= v_now - make_interval(days => p_days)
      )::bigint as current_impressions,
      count(e.id) filter (
        where e.exposed_at >= v_now - make_interval(days => p_days)
          and coalesce(f.detail_open, false)
      )::bigint as current_details,
      count(e.id) filter (
        where e.exposed_at >= v_now - make_interval(days => p_days)
          and coalesce(f.episode_1_read, false)
      )::bigint as current_first_reads,
      count(e.id) filter (
        where e.exposed_at >= v_now - make_interval(days => p_days)
          and coalesce(f.episode_1_read, false)
          and coalesce(f.episode_2_read, false)
      )::bigint as current_second_reads,
      count(e.id) filter (
        where e.exposed_at >= v_now - make_interval(days => p_days)
          and coalesce(f.favorite_added, false)
      )::bigint as current_favorites,
      count(e.id) filter (
        where e.exposed_at < v_now - make_interval(days => p_days)
      )::bigint as previous_impressions,
      count(e.id) filter (
        where e.exposed_at < v_now - make_interval(days => p_days)
          and coalesce(f.detail_open, false)
      )::bigint as previous_details,
      count(e.id) filter (
        where e.exposed_at < v_now - make_interval(days => p_days)
          and coalesce(f.episode_1_read, false)
      )::bigint as previous_first_reads,
      count(e.id) filter (
        where e.exposed_at < v_now - make_interval(days => p_days)
          and coalesce(f.episode_1_read, false)
          and coalesce(f.episode_2_read, false)
      )::bigint as previous_second_reads,
      count(e.id) filter (
        where e.exposed_at < v_now - make_interval(days => p_days)
          and coalesce(f.favorite_added, false)
      )::bigint as previous_favorites
    from owned_exposures e
    left join conversion_flags f on f.exposure_id = e.id
  )
  select
    ((d.bucket_end - interval '1 second') at time zone 'Asia/Tokyo')::date,
    d.impressions,
    d.detail_opens,
    d.first_reads,
    d.second_reads,
    d.favorites,
    t.current_impressions,
    t.current_details,
    t.current_first_reads,
    t.current_second_reads,
    t.current_favorites,
    t.previous_impressions,
    t.previous_details,
    t.previous_first_reads,
    t.previous_second_reads,
    t.previous_favorites
  from daily d
  cross join totals t
  order by d.bucket_index;
end
$$;

revoke all on function public.novelight_author_analytics_timeseries(integer)
  from public, anon;
grant execute on function public.novelight_author_analytics_timeseries(integer)
  to authenticated;

commit;