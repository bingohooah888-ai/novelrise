-- NOVELIGHT beta exposure v2.
-- 1) Explicitly prioritize new works that have not yet received a small initial
--    exposure sample, including Free works.
-- 2) Add a measurable Standard/Premium plan-extra surface instead of relying
--    only on an opaque weight uplift.
-- 3) Keep the existing v1 RPCs for compatibility; beta UI should use v2.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823171000'));

alter table public.novel_exposure_rules
  add column initial_exposure_target integer not null default 6
    check (initial_exposure_target between 1 and 100),
  add column initial_exposure_window_days integer not null default 30
    check (initial_exposure_window_days between 1 and 180),
  add column premium_plan_extra_weight numeric(6,3) not null default 1.250
    check (premium_plan_extra_weight >= 1);

alter table public.novel_exposure_events
  add column allocation_reason text not null default 'balanced'
  check (allocation_reason in ('balanced', 'initial_exposure', 'plan_extra', 'premium_extra'));

alter table public.novel_exposure_events
  drop constraint if exists novel_exposure_events_surface_check;

alter table public.novel_exposure_events
  add constraint novel_exposure_events_surface_check
  check (surface in ('home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended'));

create index novel_exposure_reason_recent_idx
  on public.novel_exposure_events (allocation_reason, exposed_at desc);

create or replace function public.novelight_discovery_feed_v2(
  p_surface text,
  p_limit integer default 24,
  p_keyword text default null,
  p_genre text default null,
  p_visitor_token text default null
)
returns table (
  feed_position integer,
  novel_id text,
  title text,
  genre text,
  description text,
  author_id uuid,
  author_plan text,
  created_at timestamptz,
  pv bigint,
  favorite_count bigint,
  is_premium_slot boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_viewer_key text;
begin
  if p_surface not in ('home_discovery', 'search_recommended') then
    raise exception using errcode = '22023', message = 'Unsupported discovery surface';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'Discovery limit must be between 1 and 100';
  end if;

  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  else
    if p_visitor_token is null
       or length(btrim(p_visitor_token)) < 8
       or length(btrim(p_visitor_token)) > 128 then
      raise exception using errcode = '22023', message = 'Anonymous discovery requires a visitor token';
    end if;
    v_viewer_key := 'visitor:' || btrim(p_visitor_token);
  end if;

  return query
  with rule as materialized (
    select r.* from public.novel_exposure_rules r where r.id = 1
  ),
  base as materialized (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.user_id as author_id,
      case lower(coalesce(p.plan, 'free'))
        when 'standard' then 'standard'
        when 'premium' then 'premium'
        else 'free'
      end as author_plan,
      n.created_at,
      coalesce(n.pv, 0)::bigint as pv,
      (
        select count(*)::bigint from public.favorites f
        where f.novel_id::text = n.id::text
      ) as favorite_count,
      case lower(coalesce(p.plan, 'free'))
        when 'standard' then r.standard_weight
        when 'premium' then r.premium_weight
        else r.free_weight
      end *
      case
        when lower(coalesce(p.plan, 'free')) = 'premium'
          and n.created_at >= now() - make_interval(hours => r.premium_new_work_hours)
        then r.premium_new_work_boost
        else 1::numeric
      end as effective_weight,
      r.rule_version,
      r.viewer_repeat_hours,
      r.initial_exposure_target,
      r.initial_exposure_window_days
    from public.novels n
    left join public.profiles p on p.id = n.user_id
    cross join rule r
    where n.status = 'published'
      and (
        p_keyword is null
        or btrim(p_keyword) = ''
        or lower(coalesce(n.title, '')) like '%' || lower(btrim(p_keyword)) || '%'
        or lower(coalesce(n.description, '')) like '%' || lower(btrim(p_keyword)) || '%'
      )
      and (
        p_genre is null
        or btrim(p_genre) = ''
        or n.genre = p_genre
      )
  ),
  metrics as materialized (
    select
      b.*,
      (
        select count(*)::bigint from public.novel_exposure_events e
        where e.author_id_snapshot = b.author_id
          and e.exposed_at >= now() - interval '7 days'
      ) as author_exposures_7d,
      (
        select count(*)::bigint from public.novel_exposure_events e
        where e.novel_id_snapshot = b.novel_id
          and e.exposed_at >= now() - interval '7 days'
      ) as novel_exposures_7d,
      (
        select count(*)::bigint from public.novel_exposure_events e
        where e.novel_id_snapshot = b.novel_id
      ) as novel_exposures_total,
      exists (
        select 1 from public.novel_exposure_events e
        where e.viewer_key = v_viewer_key
          and e.novel_id_snapshot = b.novel_id
          and e.surface in ('home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended')
          and e.exposed_at >= now() - make_interval(hours => b.viewer_repeat_hours)
      ) as recently_seen,
      md5(v_viewer_key || ':' || b.novel_id || ':' || date_trunc('hour', now())::text) as tie_breaker
    from base b
  ),
  ranked as materialized (
    select
      m.*,
      (
        m.created_at >= now() - make_interval(days => m.initial_exposure_window_days)
        and m.novel_exposures_total < m.initial_exposure_target
      ) as needs_initial_exposure,
      row_number() over (
        partition by m.author_id
        order by
          m.recently_seen asc,
          (m.created_at >= now() - make_interval(days => m.initial_exposure_window_days)
             and m.novel_exposures_total < m.initial_exposure_target) desc,
          m.novel_exposures_7d asc,
          m.created_at desc,
          m.tie_breaker
      ) as author_work_rank,
      (m.author_exposures_7d + 1)::numeric / m.effective_weight as normalized_author_exposure,
      (m.novel_exposures_7d + 1)::numeric / m.effective_weight as normalized_novel_exposure
    from metrics m
  ),
  ordered_general as materialized (
    select
      row_number() over (
        order by
          r.recently_seen asc,
          r.needs_initial_exposure desc,
          r.author_work_rank asc,
          r.normalized_author_exposure asc,
          r.normalized_novel_exposure asc,
          r.tie_breaker
      )::integer as feed_position,
      r.*
    from ranked r
  ),
  general as materialized (
    select g.* from ordered_general g where g.feed_position <= p_limit
  ),
  premium_ranked as materialized (
    select
      r.*,
      row_number() over (
        order by
          r.recently_seen asc,
          r.needs_initial_exposure desc,
          r.normalized_novel_exposure asc,
          r.normalized_author_exposure asc,
          r.tie_breaker
      ) as premium_rank
    from ranked r
    where p_surface = 'home_discovery'
      and r.author_plan = 'premium'
      and not exists (select 1 from general g where g.novel_id = r.novel_id)
  )
  select
    g.feed_position,
    g.novel_id,
    g.title,
    g.genre,
    g.description,
    g.author_id,
    g.author_plan,
    g.created_at,
    g.pv,
    g.favorite_count,
    false as is_premium_slot
  from general g

  union all

  select
    (p_limit + 1)::integer,
    p.novel_id,
    p.title,
    p.genre,
    p.description,
    p.author_id,
    p.author_plan,
    p.created_at,
    p.pv,
    p.favorite_count,
    true
  from premium_ranked p
  where p.premium_rank = 1

  order by feed_position;
end
$$;

revoke all on function public.novelight_discovery_feed_v2(text, integer, text, text, text) from public;
grant execute on function public.novelight_discovery_feed_v2(text, integer, text, text, text)
  to anon, authenticated;

-- Explicit plan-extra surface. Standard and Premium both qualify; Premium has a
-- modest extra-selection weight. This surface is separate from the general feed
-- so its impressions can be counted as actual paid-plan additional exposure.
create or replace function public.novelight_plan_extra_feed(
  p_limit integer default 1,
  p_exclude_novel_ids text[] default '{}'::text[],
  p_visitor_token text default null
)
returns table (
  feed_position integer,
  novel_id text,
  title text,
  genre text,
  description text,
  author_id uuid,
  author_plan text,
  created_at timestamptz,
  pv bigint,
  favorite_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_viewer_key text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 3 then
    raise exception using errcode = '22023', message = 'Plan extra limit must be between 1 and 3';
  end if;

  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  else
    if p_visitor_token is null
       or length(btrim(p_visitor_token)) < 8
       or length(btrim(p_visitor_token)) > 128 then
      raise exception using errcode = '22023', message = 'Anonymous discovery requires a visitor token';
    end if;
    v_viewer_key := 'visitor:' || btrim(p_visitor_token);
  end if;

  return query
  with rule as materialized (
    select r.* from public.novel_exposure_rules r where r.id = 1
  ),
  candidates as materialized (
    select
      n.id::text as novel_id,
      n.title,
      n.genre,
      n.description,
      n.user_id as author_id,
      lower(p.plan) as author_plan,
      n.created_at,
      coalesce(n.pv, 0)::bigint as pv,
      (select count(*)::bigint from public.favorites f where f.novel_id::text = n.id::text) as favorite_count,
      case when lower(p.plan) = 'premium' then r.premium_plan_extra_weight else 1::numeric end as plan_weight,
      r.viewer_repeat_hours
    from public.novels n
    join public.profiles p on p.id = n.user_id
    cross join rule r
    where n.status = 'published'
      and lower(p.plan) in ('standard', 'premium')
      and not (n.id::text = any(coalesce(p_exclude_novel_ids, '{}'::text[])))
  ),
  scored as (
    select
      c.*,
      exists (
        select 1 from public.novel_exposure_events e
        where e.viewer_key = v_viewer_key
          and e.novel_id_snapshot = c.novel_id
          and e.exposed_at >= now() - make_interval(hours => c.viewer_repeat_hours)
      ) as recently_seen,
      (
        select count(*)::bigint from public.novel_exposure_events e
        where e.novel_id_snapshot = c.novel_id
          and e.surface = 'home_plan_extra'
          and e.exposed_at >= now() - interval '7 days'
      ) as plan_extra_7d,
      (
        select count(*)::bigint from public.novel_exposure_events e
        where e.author_id_snapshot = c.author_id
          and e.exposed_at >= now() - interval '7 days'
      ) as author_exposure_7d,
      md5(v_viewer_key || ':plan-extra:' || c.novel_id || ':' || date_trunc('hour', now())::text) as tie_breaker
    from candidates c
  ),
  ordered as (
    select
      row_number() over (
        order by
          s.recently_seen asc,
          (s.plan_extra_7d + 1)::numeric / s.plan_weight asc,
          s.author_exposure_7d asc,
          s.tie_breaker
      )::integer as feed_position,
      s.*
    from scored s
  )
  select
    o.feed_position,
    o.novel_id,
    o.title,
    o.genre,
    o.description,
    o.author_id,
    o.author_plan,
    o.created_at,
    o.pv,
    o.favorite_count
  from ordered o
  where o.feed_position <= p_limit
  order by o.feed_position;
end
$$;

revoke all on function public.novelight_plan_extra_feed(integer, text[], text) from public;
grant execute on function public.novelight_plan_extra_feed(integer, text[], text)
  to anon, authenticated;

create or replace function public.record_novel_impressions_v2(
  p_surface text,
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
  v_viewer_key text;
  v_inserted integer := 0;
begin
  if p_surface not in ('home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended') then
    raise exception using errcode = '22023', message = 'Unsupported impression surface';
  end if;

  if p_novel_ids is null or cardinality(p_novel_ids) < 1 or cardinality(p_novel_ids) > 24 then
    raise exception using errcode = '22023', message = 'Impression batch must contain between 1 and 24 works';
  end if;

  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  else
    if p_visitor_token is null
       or length(btrim(p_visitor_token)) < 8
       or length(btrim(p_visitor_token)) > 128 then
      raise exception using errcode = '22023', message = 'Anonymous impressions require a visitor token';
    end if;
    v_viewer_key := 'visitor:' || btrim(p_visitor_token);
  end if;

  insert into public.novel_exposure_events (
    viewer_key,
    viewer_id,
    surface,
    novel_id_snapshot,
    author_id_snapshot,
    plan_snapshot,
    rule_version,
    allocation_reason,
    exposed_at,
    exposure_hour
  )
  select
    v_viewer_key,
    v_uid,
    p_surface,
    n.id::text,
    n.user_id,
    case lower(coalesce(p.plan, 'free'))
      when 'standard' then 'standard'
      when 'premium' then 'premium'
      else 'free'
    end,
    r.rule_version,
    case
      when p_surface = 'home_plan_extra' then 'plan_extra'
      when p_surface = 'home_premium_slot' then 'premium_extra'
      when n.created_at >= now() - make_interval(days => r.initial_exposure_window_days)
       and (
         select count(*) from public.novel_exposure_events prior
         where prior.novel_id_snapshot = n.id::text
       ) < r.initial_exposure_target
      then 'initial_exposure'
      else 'balanced'
    end,
    now(),
    date_trunc('hour', now())
  from public.novels n
  left join public.profiles p on p.id = n.user_id
  cross join public.novel_exposure_rules r
  where r.id = 1
    and n.status = 'published'
    and n.id::text = any(p_novel_ids)
  on conflict (viewer_key, surface, novel_id_snapshot, exposure_hour) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$$;

revoke all on function public.record_novel_impressions_v2(text, text[], text) from public;
grant execute on function public.record_novel_impressions_v2(text, text[], text)
  to anon, authenticated;

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
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Author funnel analytics require authentication';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception using errcode = '22023', message = 'Analytics window must be between 1 and 90 days';
  end if;

  return query
  with owned_exposures as materialized (
    select e.* from public.novel_exposure_events e
    where e.author_id_snapshot = v_uid
      and e.exposed_at >= now() - make_interval(days => p_days)
  ),
  conversion_flags as (
    select
      c.exposure_id,
      bool_or(c.event_type = 'detail_open') as detail_open,
      bool_or(c.event_type = 'episode_read_10s') as body_read,
      bool_or(c.event_type = 'episode_read_10s'
        and coalesce(c.episode_number_snapshot, ep.episode_number) = 1) as episode_1_read,
      bool_or(c.event_type = 'episode_read_10s'
        and coalesce(c.episode_number_snapshot, ep.episode_number) = 2) as episode_2_read,
      bool_or(c.event_type = 'favorite_added') as favorite_added
    from public.novel_exposure_conversions c
    left join public.episodes ep on ep.id::text = c.episode_id_snapshot
    where exists (select 1 from owned_exposures oe where oe.id = c.exposure_id)
    group by c.exposure_id
  ),
  aggregate_rows as (
    select
      e.novel_id_snapshot,
      count(*)::bigint as impressions,
      count(*) filter (where coalesce(f.detail_open, false))::bigint as detail_opens,
      count(*) filter (where coalesce(f.body_read, false))::bigint as body_reads,
      count(*) filter (where coalesce(f.episode_1_read, false))::bigint as first_episode_reads,
      count(*) filter (where coalesce(f.episode_1_read, false) and coalesce(f.episode_2_read, false))::bigint as continued_to_episode_2,
      count(*) filter (where coalesce(f.favorite_added, false))::bigint as favorites,
      count(*) filter (where e.allocation_reason = 'initial_exposure')::bigint as initial_impressions,
      count(*) filter (where e.surface = 'home_plan_extra')::bigint as plan_extra_impressions,
      count(*) filter (where e.surface = 'home_plan_extra' and coalesce(f.detail_open, false))::bigint as plan_extra_details,
      count(*) filter (where e.surface = 'home_plan_extra' and coalesce(f.body_read, false))::bigint as plan_extra_reads,
      count(*) filter (where e.surface = 'home_premium_slot')::bigint as premium_impressions,
      count(*) filter (where e.surface = 'home_premium_slot' and coalesce(f.detail_open, false))::bigint as premium_details,
      count(*) filter (where e.surface = 'home_premium_slot' and coalesce(f.body_read, false))::bigint as premium_reads
    from owned_exposures e
    left join conversion_flags f on f.exposure_id = e.id
    group by e.novel_id_snapshot
  )
  select
    a.novel_id_snapshot,
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
    a.premium_impressions,
    a.premium_details,
    a.premium_reads,
    round(100.0 * a.premium_reads / nullif(a.premium_impressions, 0), 2)
  from aggregate_rows a
  left join public.novels n on n.id::text = a.novel_id_snapshot and n.user_id = v_uid
  order by a.impressions desc, a.novel_id_snapshot;
end
$$;

revoke all on function public.novelight_author_exposure_funnel_v2(integer) from public, anon;
grant execute on function public.novelight_author_exposure_funnel_v2(integer) to authenticated;

commit;
