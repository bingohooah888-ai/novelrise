-- Return both recommendation RPCs to their immediately preceding definitions.
begin;
do $plan_only_rollback_guard$
begin
  if strpos(pg_get_functiondef('public.novelight_discovery_feed_v2(text,integer,text,text,text)'::regprocedure), '4503599627370496') = 0
     or strpos(pg_get_functiondef('public.novelight_plan_extra_feed(integer,text[],text)'::regprocedure), '4503599627370496') = 0 then
    raise exception 'Plan-only recommendation rollback: unexpected current definitions';
  end if;
end
$plan_only_rollback_guard$;

CREATE OR REPLACE FUNCTION public.novelight_discovery_feed_v2(p_surface text, p_limit integer DEFAULT 24, p_keyword text DEFAULT NULL::text, p_genre text DEFAULT NULL::text, p_visitor_token text DEFAULT NULL::text)
 RETURNS TABLE(feed_position integer, novel_id text, title text, genre text, description text, author_id uuid, author_plan text, created_at timestamp with time zone, pv bigint, favorite_count bigint, is_premium_slot boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
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
      public.novelight_effective_publication_at(
        n.created_at, n.first_published_at
      ) as effective_publication_at,
      coalesce(n.pv, 0)::bigint as pv,
      (
        select count(*)::bigint from public.favorites f
        where f.novel_id::text = n.id::text
          and f.user_id <> n.user_id
      ) as favorite_count,
      case lower(coalesce(p.plan, 'free'))
        when 'standard' then r.standard_weight
        when 'premium' then r.premium_weight
        else r.free_weight
      end *
      case
        when lower(coalesce(p.plan, 'free')) = 'premium'
          and public.novelight_effective_publication_at(n.created_at, n.first_published_at) <= now()
          and public.novelight_effective_publication_at(n.created_at, n.first_published_at) >= now() - make_interval(hours => r.premium_new_work_hours)
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
    where n.status = 'published' and public.novelight_is_general_discovery_eligible(n.ai_usage, n.content_rating)
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
          and e.exposed_at >= public.novelight_exposure_balance_start(now())
      ) as author_exposures_7d,
      (
        select count(*)::bigint from public.novel_exposure_events e
        where e.novel_id_snapshot = b.novel_id
          and e.exposed_at >= public.novelight_exposure_balance_start(now())
      ) as novel_exposures_7d,
      (
        select count(*)::bigint from public.novel_exposure_events e
        where e.novel_id_snapshot = b.novel_id
          and e.exposed_at >= b.effective_publication_at
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
        m.effective_publication_at <= now()
        and m.effective_publication_at >= now() - make_interval(days => m.initial_exposure_window_days)
        and m.novel_exposures_total < m.initial_exposure_target
      ) as needs_initial_exposure,
      row_number() over (
        partition by m.author_id
        order by
          m.recently_seen asc,
          (m.effective_publication_at <= now()
        and m.effective_publication_at >= now() - make_interval(days => m.initial_exposure_window_days)
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
$function$;

CREATE OR REPLACE FUNCTION public.novelight_plan_extra_feed(p_limit integer DEFAULT 1, p_exclude_novel_ids text[] DEFAULT '{}'::text[], p_visitor_token text DEFAULT NULL::text)
 RETURNS TABLE(feed_position integer, novel_id text, title text, genre text, description text, author_id uuid, author_plan text, created_at timestamp with time zone, pv bigint, favorite_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
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
    where n.status = 'published' and public.novelight_is_general_discovery_eligible(n.ai_usage, n.content_rating)
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
$function$;

commit;
