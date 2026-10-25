-- Reject oversized caller-controlled arrays before any expensive feed query.
-- The trusted wrapper delegates here and inherits the same input bound.
-- Reader-facing homepage currently supplies far fewer than 128 exclusions.
-- Preserve grants, signatures, ranking, and anonymous access.
begin;

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

  -- Public RPC input must stay bounded even when called outside the UI.
  -- Home normally excludes at most 101 displayed works.
  if coalesce(cardinality(p_exclude_novel_ids), 0) > 128 then
    raise exception using
      errcode = '22023',
      message = 'Too many excluded novel IDs';
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
      md5(v_viewer_key || ':plan-extra:' || c.novel_id || ':' || date_trunc('hour', now())::text) as tie_breaker
    from candidates c
  ),
  ordered as (
    select
      row_number() over (
        order by
          -ln((('x' || substr(s.tie_breaker, 1, 13))::bit(52)::bigint + 0.5)::numeric / 4503599627370496::numeric) / greatest(s.plan_weight, 0.000001::numeric) asc,
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
