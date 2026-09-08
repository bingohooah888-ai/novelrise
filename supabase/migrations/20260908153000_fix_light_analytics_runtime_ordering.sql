-- Repair LIGHT ANALYTICS runtime ordering after the plan-entitlement migration.
-- RETURNS TABLE output names are PL/pgSQL variables, so unqualified ORDER BY
-- references can be ambiguous at first execution. Keep the entitlement semantics
-- unchanged and order by output positions instead.
-- Production application requires separate OWNER approval.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260908153000'));

create or replace function public.novelight_author_exposure_funnel_v2(
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
  initial_exposure_impressions bigint,
  plan_extra_impressions bigint,
  plan_extra_detail_opens bigint,
  plan_extra_body_reads_10s bigint,
  plan_extra_body_read_rate_pct numeric,
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
$$;

revoke all on function public.novelight_author_exposure_funnel_v2(integer)
  from public, anon;
grant execute on function public.novelight_author_exposure_funnel_v2(integer)
  to authenticated;

-- Recreate the compatibility endpoint so its dependency is compiled against the
-- repaired v2 contract without changing its public result shape.
create or replace function public.novelight_author_exposure_funnel(
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
begin
  return query
  select
    f.novel_id,
    f.title,
    f.impressions,
    f.detail_opens,
    f.body_reads_10s,
    f.detail_rate_pct,
    f.body_read_rate_pct,
    f.first_episode_reads_10s,
    f.continued_to_episode_2,
    f.episode1_to_episode2_rate_pct,
    f.favorites,
    f.favorite_rate_pct,
    f.premium_slot_impressions,
    f.premium_slot_detail_opens,
    f.premium_slot_body_reads_10s,
    f.premium_slot_body_read_rate_pct
  from public.novelight_author_exposure_funnel_v2(p_days) f;
end
$$;

revoke all on function public.novelight_author_exposure_funnel(integer)
  from public, anon;
grant execute on function public.novelight_author_exposure_funnel(integer)
  to authenticated;

commit;
