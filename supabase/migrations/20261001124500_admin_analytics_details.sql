-- Server-side detailed analytics for NOVELIGHT ADMIN.
-- The function returns aggregated JSON only and is executable by service_role only.

create or replace function public.novelight_admin_analytics_snapshot(p_days integer default 30)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
with params as (
  select
    case when p_days in (7, 30, 90) then p_days else 30 end as days,
    (now() at time zone 'Asia/Tokyo')::date as end_date
), bounds as (
  select
    days,
    end_date,
    end_date - (days - 1) as start_date,
    ((end_date - (days - 1))::timestamp at time zone 'Asia/Tokyo') as start_ts,
    ((end_date + 1)::timestamp at time zone 'Asia/Tokyo') as end_ts
  from params
), activity as materialized (
  select b.*
  from public.beta_activity_days b, bounds x
  where b.activity_date between x.start_date and x.end_date
), journey as materialized (
  select r.*
  from public.reader_journey_events r, bounds x
  where r.occurred_at >= x.start_ts and r.occurred_at < x.end_ts
), registrations as materialized (
  select u.*
  from public.user_lifecycle u, bounds x
  where u.registered_at >= x.start_ts and u.registered_at < x.end_ts
), first_novel as materialized (
  select distinct on (n.user_id)
    n.user_id,
    n.id as novel_id,
    n.created_at
  from public.novels n
  where n.user_id is not null
  order by n.user_id, n.created_at, n.id
), author_users as materialized (
  select distinct n.user_id from public.novels n where n.user_id is not null
), reader_users as materialized (
  select distinct r.user_id
  from public.reader_journey_events r
  where r.user_id is not null and r.event_type = 'episode_read_10s'
), usage as (
  select jsonb_build_object(
    'dau', (select count(distinct a.user_id) from activity a, bounds x where a.activity_date = x.end_date and a.user_id is not null),
    'wau', (select count(distinct a.user_id) from activity a, bounds x where a.activity_date between x.end_date - 6 and x.end_date and a.user_id is not null),
    'mau', (select count(distinct b.user_id) from public.beta_activity_days b, bounds x where b.activity_date between x.end_date - 29 and x.end_date and b.user_id is not null),
    'uniqueVisitors', (select count(distinct a.viewer_key_hash) from activity a),
    'newUsers', (select count(*) from registrations),
    'repeatVisitors', (select count(*) from (select a.viewer_key_hash from activity a group by a.viewer_key_hash having count(distinct a.activity_date) >= 2) q),
    'episodePageviews', (select count(*) from public.episode_pv_events e, bounds x where e.counted_at >= x.start_ts and e.counted_at < x.end_ts),
    'readingUsers', (select count(distinct j.viewer_key_hash) from journey j where j.event_type = 'episode_read_10s'),
    'worksPerReader', coalesce((
      select round(count(distinct (j.viewer_key_hash, j.novel_id_snapshot))::numeric / nullif(count(distinct j.viewer_key_hash), 0), 2)
      from journey j where j.event_type = 'episode_read_10s'
    ), 0)
  ) as value
), reader_funnel as (
  select jsonb_build_object(
    'siteVisit', (select count(distinct a.viewer_key_hash) from activity a),
    'workDetail', (select count(distinct j.viewer_key_hash) from journey j where j.event_type = 'detail_open'),
    'episode1Read10s', (select count(distinct j.viewer_key_hash) from journey j join public.episodes e on e.id::text = j.episode_id_snapshot where j.event_type = 'episode_read_10s' and e.episode_number = 1),
    'episode1ValidRead', (select count(distinct v.reader_id) from public.valid_read_events v join public.episodes e on e.id::text = v.episode_id_snapshot, bounds x where v.qualified_at >= x.start_ts and v.qualified_at < x.end_ts and e.episode_number = 1),
    'episode2ValidRead', (select count(distinct v.reader_id) from public.valid_read_events v join public.episodes e on e.id::text = v.episode_id_snapshot, bounds x where v.qualified_at >= x.start_ts and v.qualified_at < x.end_ts and e.episode_number = 2),
    'multiEpisodeValidRead', (select count(*) from (select v.reader_id from public.valid_read_events v join public.episodes e on e.id::text = v.episode_id_snapshot, bounds x where v.qualified_at >= x.start_ts and v.qualified_at < x.end_ts group by v.reader_id having count(distinct e.id) >= 2) q),
    'favoriteUsers', (select count(distinct f.user_id) from public.favorites f, bounds x where f.created_at >= x.start_ts and f.created_at < x.end_ts),
    'followUsers', (select count(distinct f.follower_user_id) from public.author_follows f, bounds x where f.created_at >= x.start_ts and f.created_at < x.end_ts),
    'revisit', (select count(*) from (select a.viewer_key_hash from activity a group by a.viewer_key_hash having count(distinct a.activity_date) >= 2) q)
  ) as value
), author_funnel as (
  select jsonb_build_object(
    'siteVisit', (select count(distinct a.viewer_key_hash) from activity a),
    'registered', (select count(*) from registrations),
    'authorStarted', (select count(distinct r.user_id) from registrations r join first_novel n on n.user_id = r.user_id, bounds x where n.created_at < x.end_ts),
    'workCreated', (select count(distinct r.user_id) from registrations r join public.novels n on n.user_id = r.user_id, bounds x where n.created_at >= r.registered_at and n.created_at < x.end_ts),
    'episode1Published', (select count(distinct r.user_id) from registrations r join public.episodes e on e.user_id = r.user_id, bounds x where e.episode_number = 1 and e.status = 'published' and e.created_at < x.end_ts),
    'episode2Published', (select count(distinct r.user_id) from registrations r join public.episodes e on e.user_id = r.user_id, bounds x where e.episode_number = 2 and e.status = 'published' and e.created_at < x.end_ts),
    'continued7d', (select count(distinct r.user_id) from registrations r join public.episodes e on e.user_id = r.user_id, bounds x where e.created_at >= r.registered_at + interval '7 days' and e.created_at < x.end_ts),
    'continued30d', (select count(distinct r.user_id) from registrations r join public.episodes e on e.user_id = r.user_id, bounds x where e.created_at >= r.registered_at + interval '30 days' and e.created_at < x.end_ts),
    'registrationToFirstWorkRate', coalesce((select round(100.0 * count(n.user_id) / nullif(count(*), 0), 1) from registrations r left join first_novel n on n.user_id = r.user_id), 0),
    'avgHoursToFirstWork', coalesce((select round(avg(extract(epoch from (n.created_at - r.registered_at)) / 3600.0)::numeric, 1) from registrations r join first_novel n on n.user_id = r.user_id where n.created_at >= r.registered_at), 0)
  ) as value
), retention_base as materialized (
  select
    r.user_id,
    (r.registered_at at time zone 'Asia/Tokyo')::date as cohort_date,
    exists(select 1 from author_users a where a.user_id = r.user_id) as is_author,
    exists(select 1 from reader_users rd where rd.user_id = r.user_id) as is_reader
  from registrations r
), retention as (
  select jsonb_build_object(
    'all', jsonb_build_object(
      'd1', coalesce((select round(100.0 * count(*) filter (where exists(select 1 from public.beta_activity_days b where b.user_id = r.user_id and b.activity_date = r.cohort_date + 1)) / nullif(count(*) filter (where r.cohort_date <= x.end_date - 1), 0), 1) from retention_base r, bounds x where r.cohort_date <= x.end_date - 1), 0),
      'd7', coalesce((select round(100.0 * count(*) filter (where exists(select 1 from public.beta_activity_days b where b.user_id = r.user_id and b.activity_date = r.cohort_date + 7)) / nullif(count(*) filter (where r.cohort_date <= x.end_date - 7), 0), 1) from retention_base r, bounds x where r.cohort_date <= x.end_date - 7), 0),
      'd30', coalesce((select round(100.0 * count(*) filter (where exists(select 1 from public.beta_activity_days b where b.user_id = r.user_id and b.activity_date = r.cohort_date + 30)) / nullif(count(*) filter (where r.cohort_date <= x.end_date - 30), 0), 1) from retention_base r, bounds x where r.cohort_date <= x.end_date - 30), 0)
    ),
    'authors', jsonb_build_object(
      'd1', coalesce((select round(100.0 * count(*) filter (where exists(select 1 from public.beta_activity_days b where b.user_id = r.user_id and b.activity_date = r.cohort_date + 1)) / nullif(count(*), 0), 1) from retention_base r, bounds x where r.is_author and r.cohort_date <= x.end_date - 1), 0),
      'd7', coalesce((select round(100.0 * count(*) filter (where exists(select 1 from public.beta_activity_days b where b.user_id = r.user_id and b.activity_date = r.cohort_date + 7)) / nullif(count(*), 0), 1) from retention_base r, bounds x where r.is_author and r.cohort_date <= x.end_date - 7), 0),
      'd30', coalesce((select round(100.0 * count(*) filter (where exists(select 1 from public.beta_activity_days b where b.user_id = r.user_id and b.activity_date = r.cohort_date + 30)) / nullif(count(*), 0), 1) from retention_base r, bounds x where r.is_author and r.cohort_date <= x.end_date - 30), 0)
    ),
    'readers', jsonb_build_object(
      'd1', coalesce((select round(100.0 * count(*) filter (where exists(select 1 from public.beta_activity_days b where b.user_id = r.user_id and b.activity_date = r.cohort_date + 1)) / nullif(count(*), 0), 1) from retention_base r, bounds x where r.is_reader and r.cohort_date <= x.end_date - 1), 0),
      'd7', coalesce((select round(100.0 * count(*) filter (where exists(select 1 from public.beta_activity_days b where b.user_id = r.user_id and b.activity_date = r.cohort_date + 7)) / nullif(count(*), 0), 1) from retention_base r, bounds x where r.is_reader and r.cohort_date <= x.end_date - 7), 0),
      'd30', coalesce((select round(100.0 * count(*) filter (where exists(select 1 from public.beta_activity_days b where b.user_id = r.user_id and b.activity_date = r.cohort_date + 30)) / nullif(count(*), 0), 1) from retention_base r, bounds x where r.is_reader and r.cohort_date <= x.end_date - 30), 0)
    )
  ) as value
), published_works as materialized (
  select n.* from public.novels n where n.status = 'published'
), work_exposure_counts as materialized (
  select w.id, count(e.id)::numeric as exposures
  from published_works w
  left join public.novel_exposure_events e on e.novel_id_snapshot = w.id::text
    and e.exposed_at >= (select start_ts from bounds)
    and e.exposed_at < (select end_ts from bounds)
  group by w.id
), author_exposure_counts as materialized (
  select w.user_id, sum(wc.exposures)::numeric as exposures
  from published_works w join work_exposure_counts wc on wc.id = w.id
  where w.user_id is not null
  group by w.user_id
), work_gini as (
  select coalesce(case when sum(exposures) = 0 or count(*) < 2 then 0 else round((2 * sum(rn * exposures) / (count(*) * sum(exposures)) - (count(*) + 1)::numeric / count(*))::numeric, 3) end, 0) as value
  from (select exposures, row_number() over(order by exposures) as rn from work_exposure_counts) q
), author_gini as (
  select coalesce(case when sum(exposures) = 0 or count(*) < 2 then 0 else round((2 * sum(rn * exposures) / (count(*) * sum(exposures)) - (count(*) + 1)::numeric / count(*))::numeric, 3) end, 0) as value
  from (select exposures, row_number() over(order by exposures) as rn from author_exposure_counts) q
), first_work as materialized (
  select distinct on (n.user_id) n.user_id,n.id,n.status,n.pv,n.first_published_at
  from public.novels n where n.user_id is not null order by n.user_id,n.created_at,n.id
), first_reads as materialized (
  select n.id as novel_id, min(j.occurred_at) as first_read_at
  from published_works n
  join public.reader_journey_events j on j.novel_id_snapshot = n.id::text and j.event_type = 'episode_read_10s'
  where n.first_published_at is not null and j.occurred_at >= n.first_published_at
  group by n.id
), discovery as (
  select jsonb_build_object(
    'publishedWorks', (select count(*) from published_works),
    'zeroPvWorks', (select count(*) from published_works where coalesce(pv,0)=0),
    'zeroPvRate', coalesce((select round(100.0 * count(*) filter(where coalesce(pv,0)=0) / nullif(count(*),0),1) from published_works),0),
    'newAuthorWorkReadRate', coalesce((select round(100.0 * count(*) filter(where status='published' and coalesce(pv,0)>0) / nullif(count(*) filter(where status='published'),0),1) from first_work),0),
    'medianHoursToFirstReader', coalesce((select round(percentile_cont(0.5) within group(order by extract(epoch from (f.first_read_at-n.first_published_at))/3600.0)::numeric,1) from first_reads f join published_works n on n.id=f.novel_id),0),
    'workExposureGini', (select value from work_gini),
    'authorExposureGini', (select value from author_gini)
  ) as value
), source_keys as materialized (
  select coalesce(nullif(source,''),'direct') as source
  from public.acquisition_touches a, bounds x where a.touched_at >= x.start_ts and a.touched_at < x.end_ts
  union
  select coalesce(nullif(source,''),'direct')
  from public.user_acquisition u, bounds x where u.first_touched_at >= x.start_ts and u.first_touched_at < x.end_ts
), acquisition as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'source', s.source,
    'visitors', (select count(distinct a.visitor_key_hash) from public.acquisition_touches a, bounds x where coalesce(nullif(a.source,''),'direct')=s.source and a.touched_at >= x.start_ts and a.touched_at < x.end_ts),
    'registered', (select count(distinct u.user_id) from public.user_acquisition u, bounds x where coalesce(nullif(u.source,''),'direct')=s.source and u.first_touched_at >= x.start_ts and u.first_touched_at < x.end_ts),
    'readers', (select count(distinct j.user_id) from public.user_acquisition u join journey j on j.user_id=u.user_id where coalesce(nullif(u.source,''),'direct')=s.source and j.event_type='episode_read_10s'),
    'authors', (select count(distinct n.user_id) from public.user_acquisition u join public.novels n on n.user_id=u.user_id, bounds x where coalesce(nullif(u.source,''),'direct')=s.source and n.created_at >= x.start_ts and n.created_at < x.end_ts)
  ) order by (select count(distinct a.visitor_key_hash) from public.acquisition_touches a, bounds x where coalesce(nullif(a.source,''),'direct')=s.source and a.touched_at >= x.start_ts and a.touched_at < x.end_ts) desc), '[]'::jsonb) as value
  from source_keys s
), plan_exposure as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'plan', q.plan,
    'exposures', q.exposures,
    'detailOpens', q.detail_opens,
    'reads', q.reads
  ) order by q.exposures desc), '[]'::jsonb) as value
  from (
    select
      coalesce(nullif(e.plan_snapshot,''),'unknown') as plan,
      count(*) as exposures,
      count(distinct c.exposure_id) filter(where c.event_type='detail_open') as detail_opens,
      count(distinct c.exposure_id) filter(where c.event_type='episode_read_10s') as reads
    from public.novel_exposure_events e
    left join public.novel_exposure_conversions c on c.exposure_id=e.id
    cross join bounds x
    where e.exposed_at >= x.start_ts and e.exposed_at < x.end_ts
    group by coalesce(nullif(e.plan_snapshot,''),'unknown')
  ) q
), weekdays as (
  select coalesce(jsonb_agg(jsonb_build_object('dow',q.dow,'users',q.users) order by q.dow),'[]'::jsonb) as value
  from (select extract(dow from a.activity_date)::int as dow,count(distinct a.viewer_key_hash) as users from activity a group by 1) q
), hours as (
  select coalesce(jsonb_agg(jsonb_build_object('hour',q.hour,'users',q.users) order by q.hour),'[]'::jsonb) as value
  from (select extract(hour from j.occurred_at at time zone 'Asia/Tokyo')::int as hour,count(distinct j.viewer_key_hash) as users from journey j group by 1) q
)
select jsonb_build_object(
  'rangeDays', (select days from bounds),
  'generatedAt', now(),
  'usage', (select value from usage),
  'readerFunnel', (select value from reader_funnel),
  'authorFunnel', (select value from author_funnel),
  'retention', (select value from retention),
  'discovery', (select value from discovery),
  'acquisition', (select value from acquisition),
  'planExposure', (select value from plan_exposure),
  'weekdayUsage', (select value from weekdays),
  'hourUsage', (select value from hours),
  'measurementStarts', jsonb_build_object(
    'traffic','2026-08-23',
    'readerJourney','2026-08-23',
    'episodePageviews','2026-09-01',
    'validRead','2026-09-12',
    'exposure','2026-08-28'
  ),
  'caveats', jsonb_build_array(
    '第1話読了は現行データで厳密なページ末到達を判定できないため、valid_readを「有効読書」として表示します。',
    '作者7日/30日継続は登録後7日/30日以降にepisodeを追加作成した作者として集計します。',
    'PVはepisode_pv_eventsの計測開始以降に限ります。'
  )
);
$$;

revoke all on function public.novelight_admin_analytics_snapshot(integer)
  from public, anon, authenticated;
grant execute on function public.novelight_admin_analytics_snapshot(integer)
  to service_role;
