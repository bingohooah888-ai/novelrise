-- Manual recovery artifact ONLY. Must run in a separately OWNER-approved
-- trusted Staging runner after confirming exact migration and database identity.
-- Restores actual pre-migration Staging function definitions; changes no user rows.
-- Migration ledger row (metadata) is deleted ONLY by this explicit rollback.
BEGIN;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='5s';

DO $retention_rollback_guard$
DECLARE
  v_funnel oid := pg_catalog.to_regprocedure('public.novelight_author_exposure_funnel_v2(integer)');
  v_series oid := pg_catalog.to_regprocedure('public.novelight_author_analytics_timeseries(integer)');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version::text='20261110172000' AND name::text='author_reader_retention_cross_visit'
  ) OR v_funnel IS NULL OR v_series IS NULL THEN
    RAISE EXCEPTION 'Retention rollback blocked: migration ledger or function missing';
  END IF;
  IF pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_functiondef(v_funnel)), 'reader_cohorts as materialized')=0
     OR pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_functiondef(v_series)), 'reader_cohorts as materialized')=0 THEN
    RAISE EXCEPTION 'Retention rollback blocked: installed function is not expected version';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_funnel)
    OR NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_series)
    OR pg_catalog.has_function_privilege('anon',v_funnel,'EXECUTE')
    OR pg_catalog.has_function_privilege('anon',v_series,'EXECUTE') THEN
    RAISE EXCEPTION 'Retention rollback blocked: privileges drifted';
  END IF;
END
$retention_rollback_guard$;

-- Exact pre-migration Staging function definitions (captured read-only).
CREATE OR REPLACE FUNCTION public.novelight_author_exposure_funnel_v2(p_days integer DEFAULT 30)
 RETURNS TABLE(novel_id text, title text, impressions bigint, detail_opens bigint, body_reads_10s bigint, detail_rate_pct numeric, body_read_rate_pct numeric, first_episode_reads_10s bigint, continued_to_episode_2 bigint, episode1_to_episode2_rate_pct numeric, favorites bigint, favorite_rate_pct numeric, initial_exposure_impressions bigint, plan_extra_impressions bigint, plan_extra_detail_opens bigint, plan_extra_body_reads_10s bigint, plan_extra_body_read_rate_pct numeric, premium_slot_impressions bigint, premium_slot_detail_opens bigint, premium_slot_body_reads_10s bigint, premium_slot_body_read_rate_pct numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_plan text := 'free';
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

  select case lower(coalesce(p.plan, 'free'))
           when 'standard' then 'standard'
           when 'premium' then 'premium'
           else 'free'
         end
    into v_plan
    from public.profiles p
   where p.id = v_uid;

  v_plan := coalesce(v_plan, 'free');

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
    left join public.episodes ep on ep.id::text = c.episode_id_snapshot
    where exists (
      select 1 from owned_exposures oe where oe.id = c.exposure_id
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
      count(*) filter (where e.allocation_reason = 'initial_exposure')::bigint as initial_impressions,
      count(*) filter (where e.surface = 'home_plan_extra')::bigint as plan_extra_impressions,
      count(*) filter (
        where e.surface = 'home_plan_extra'
          and coalesce(f.detail_open, false)
      )::bigint as plan_extra_details,
      count(*) filter (
        where e.surface = 'home_plan_extra'
          and coalesce(f.body_read, false)
      )::bigint as plan_extra_reads,
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
    a.novel_id_snapshot::text,
    coalesce(n.title, '削除済み作品')::text,
    a.impressions,
    a.detail_opens,
    a.body_reads,
    round(100.0 * a.detail_opens / nullif(a.impressions, 0), 2),
    round(100.0 * a.body_reads / nullif(a.impressions, 0), 2),
    a.first_episode_reads,
    a.continued_to_episode_2,
    round(100.0 * a.continued_to_episode_2 / nullif(a.first_episode_reads, 0), 2),
    a.favorites,
    round(100.0 * a.favorites / nullif(a.impressions, 0), 2),
    a.initial_impressions,
    a.plan_extra_impressions,
    a.plan_extra_details,
    a.plan_extra_reads,
    round(100.0 * a.plan_extra_reads / nullif(a.plan_extra_impressions, 0), 2),
    case when v_plan = 'premium' then a.premium_impressions else 0::bigint end,
    case when v_plan = 'premium' then a.premium_details else 0::bigint end,
    case when v_plan = 'premium' then a.premium_reads else 0::bigint end,
    case when v_plan = 'premium'
      then round(100.0 * a.premium_reads / nullif(a.premium_impressions, 0), 2)
      else null::numeric
    end
  from aggregate_rows a
  left join public.novels n
    on n.id::text = a.novel_id_snapshot
   and n.user_id = v_uid
  where v_plan in ('standard', 'premium')

  union all

  select
    null::text,
    null::text,
    coalesce(sum(a.impressions), 0)::bigint,
    coalesce(sum(a.detail_opens), 0)::bigint,
    coalesce(sum(a.body_reads), 0)::bigint,
    round(100.0 * coalesce(sum(a.detail_opens), 0) / nullif(coalesce(sum(a.impressions), 0), 0), 2),
    round(100.0 * coalesce(sum(a.body_reads), 0) / nullif(coalesce(sum(a.impressions), 0), 0), 2),
    coalesce(sum(a.first_episode_reads), 0)::bigint,
    coalesce(sum(a.continued_to_episode_2), 0)::bigint,
    round(100.0 * coalesce(sum(a.continued_to_episode_2), 0) / nullif(coalesce(sum(a.first_episode_reads), 0), 0), 2),
    coalesce(sum(a.favorites), 0)::bigint,
    round(100.0 * coalesce(sum(a.favorites), 0) / nullif(coalesce(sum(a.impressions), 0), 0), 2),
    coalesce(sum(a.initial_impressions), 0)::bigint,
    0::bigint,
    0::bigint,
    0::bigint,
    null::numeric,
    0::bigint,
    0::bigint,
    0::bigint,
    null::numeric
  from aggregate_rows a
  having v_plan = 'free'

  order by 3 desc nulls last, 1 nulls last;
end
$function$;

CREATE OR REPLACE FUNCTION public.novelight_author_analytics_timeseries(p_days integer DEFAULT 30)
 RETURNS TABLE(bucket_date date, impressions bigint, detail_opens bigint, first_episode_reads_10s bigint, continued_to_episode_2 bigint, favorites bigint, current_impressions bigint, current_detail_opens bigint, current_first_episode_reads_10s bigint, current_continued_to_episode_2 bigint, current_favorites bigint, previous_impressions bigint, previous_detail_opens bigint, previous_first_episode_reads_10s bigint, previous_continued_to_episode_2 bigint, previous_favorites bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
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
$function$;

REVOKE EXECUTE ON FUNCTION public.novelight_author_exposure_funnel_v2(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.novelight_author_analytics_timeseries(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novelight_author_exposure_funnel_v2(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.novelight_author_analytics_timeseries(integer) TO authenticated;

DO $retention_rollback_postcheck$
DECLARE
  v_funnel oid := pg_catalog.to_regprocedure('public.novelight_author_exposure_funnel_v2(integer)');
  v_series oid := pg_catalog.to_regprocedure('public.novelight_author_analytics_timeseries(integer)');
BEGIN
  IF encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(v_funnel),'UTF8')),'hex') <> '84db65f80613f2e1e15cab8f66c973981bdd56260ac3b866da66b29284c67653'
     OR encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(v_series),'UTF8')),'hex') <> 'e2879f44469f2cc5d4f33d5969a4b8a85ae17fa13ffb50e93c87fa136be943c3'
     OR pg_catalog.has_function_privilege('anon',v_funnel,'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',v_series,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated',v_funnel,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated',v_series,'EXECUTE') THEN
    RAISE EXCEPTION 'Retention rollback postcheck failed; entire transaction must abort';
  END IF;
END
$retention_rollback_postcheck$;

DELETE FROM supabase_migrations.schema_migrations
 WHERE version::text='20261110172000'
   AND name::text='author_reader_retention_cross_visit';
DO $retention_rollback_ledger$
BEGIN
  IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version::text='20261110172000') THEN
    RAISE EXCEPTION 'Retention rollback migration ledger was not removed';
  END IF;
END
$retention_rollback_ledger$;
COMMIT;
