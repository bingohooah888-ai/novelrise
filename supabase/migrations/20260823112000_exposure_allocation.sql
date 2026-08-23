-- NOVELIGHT beta exposure allocation and impression ledger.
-- Paid plans buy additional discovery opportunity, never ratings or ranking points.
-- Allocation is normalized at author level first so authors with many works do not
-- multiply their share simply by filling every plan slot.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823112000'));

create table public.novel_exposure_rules (
  id smallint primary key check (id = 1),
  rule_version text not null,
  free_weight numeric(6,3) not null check (free_weight > 0),
  standard_weight numeric(6,3) not null check (standard_weight >= free_weight),
  premium_weight numeric(6,3) not null check (premium_weight >= standard_weight),
  premium_new_work_boost numeric(6,3) not null check (premium_new_work_boost >= 1),
  premium_new_work_hours integer not null check (premium_new_work_hours between 1 and 168),
  viewer_repeat_hours integer not null check (viewer_repeat_hours between 1 and 72),
  updated_at timestamptz not null default now()
);

insert into public.novel_exposure_rules (
  id,
  rule_version,
  free_weight,
  standard_weight,
  premium_weight,
  premium_new_work_boost,
  premium_new_work_hours,
  viewer_repeat_hours
) values (
  1,
  'beta-v1',
  1.000,
  1.350,
  1.600,
  1.200,
  48,
  6
);

revoke all on table public.novel_exposure_rules from public, anon, authenticated;

create table public.novel_exposure_events (
  id uuid primary key default gen_random_uuid(),
  viewer_key text not null,
  viewer_id uuid,
  surface text not null check (
    surface in ('home_discovery', 'home_premium_slot', 'search_recommended')
  ),
  novel_id_snapshot text not null,
  author_id_snapshot uuid not null,
  plan_snapshot text not null check (plan_snapshot in ('free', 'standard', 'premium')),
  rule_version text not null,
  exposed_at timestamptz not null default now(),
  exposure_hour timestamptz not null,
  constraint novel_exposure_hourly_dedupe unique (
    viewer_key,
    surface,
    novel_id_snapshot,
    exposure_hour
  )
);

create index novel_exposure_author_recent_idx
  on public.novel_exposure_events (author_id_snapshot, exposed_at desc);

create index novel_exposure_novel_recent_idx
  on public.novel_exposure_events (novel_id_snapshot, exposed_at desc);

create index novel_exposure_surface_recent_idx
  on public.novel_exposure_events (surface, exposed_at desc);

revoke all on table public.novel_exposure_events from public, anon, authenticated;

create or replace function public.novelight_discovery_feed(
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
    raise exception using
      errcode = '22023',
      message = 'Unsupported discovery surface';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using
      errcode = '22023',
      message = 'Discovery limit must be between 1 and 100';
  end if;

  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  else
    if p_visitor_token is null
       or length(btrim(p_visitor_token)) < 8
       or length(btrim(p_visitor_token)) > 128 then
      raise exception using
        errcode = '22023',
        message = 'Anonymous discovery requires a visitor token';
    end if;

    v_viewer_key := 'visitor:' || btrim(p_visitor_token);
  end if;

  return query
  with rule as materialized (
    select r.*
    from public.novel_exposure_rules r
    where r.id = 1
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
        select count(*)::bigint
        from public.favorites f
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
      r.viewer_repeat_hours
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
        select count(*)::bigint
        from public.novel_exposure_events e
        where e.author_id_snapshot = b.author_id
          and e.exposed_at >= now() - interval '7 days'
      ) as author_exposures_7d,
      (
        select count(*)::bigint
        from public.novel_exposure_events e
        where e.novel_id_snapshot = b.novel_id
          and e.exposed_at >= now() - interval '7 days'
      ) as novel_exposures_7d,
      exists (
        select 1
        from public.novel_exposure_events e
        where e.viewer_key = v_viewer_key
          and e.novel_id_snapshot = b.novel_id
          and e.surface in ('home_discovery', 'home_premium_slot', 'search_recommended')
          and e.exposed_at >= now() - make_interval(hours => b.viewer_repeat_hours)
      ) as recently_seen,
      md5(
        v_viewer_key || ':' ||
        b.novel_id || ':' ||
        date_trunc('hour', now())::text
      ) as tie_breaker
    from base b
  ),
  ranked as materialized (
    select
      m.*,
      row_number() over (
        partition by m.author_id
        order by
          m.recently_seen asc,
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
          r.author_work_rank asc,
          r.normalized_author_exposure asc,
          r.normalized_novel_exposure asc,
          r.tie_breaker
      )::integer as feed_position,
      r.*
    from ranked r
  ),
  general as materialized (
    select g.*
    from ordered_general g
    where g.feed_position <= p_limit
  ),
  premium_ranked as materialized (
    select
      r.*,
      row_number() over (
        order by
          r.recently_seen asc,
          r.normalized_novel_exposure asc,
          r.normalized_author_exposure asc,
          r.tie_breaker
      ) as premium_rank
    from ranked r
    where p_surface = 'home_discovery'
      and r.author_plan = 'premium'
      and not exists (
        select 1 from general g where g.novel_id = r.novel_id
      )
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
    (p_limit + 1)::integer as feed_position,
    p.novel_id,
    p.title,
    p.genre,
    p.description,
    p.author_id,
    p.author_plan,
    p.created_at,
    p.pv,
    p.favorite_count,
    true as is_premium_slot
  from premium_ranked p
  where p.premium_rank = 1

  order by feed_position;
end
$$;

revoke all on function public.novelight_discovery_feed(text, integer, text, text, text) from public;
grant execute on function public.novelight_discovery_feed(text, integer, text, text, text) to anon, authenticated;

create or replace function public.record_novel_impressions(
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
  if p_surface not in ('home_discovery', 'home_premium_slot', 'search_recommended') then
    raise exception using
      errcode = '22023',
      message = 'Unsupported impression surface';
  end if;

  if p_novel_ids is null
     or cardinality(p_novel_ids) < 1
     or cardinality(p_novel_ids) > 24 then
    raise exception using
      errcode = '22023',
      message = 'Impression batch must contain between 1 and 24 works';
  end if;

  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  else
    if p_visitor_token is null
       or length(btrim(p_visitor_token)) < 8
       or length(btrim(p_visitor_token)) > 128 then
      raise exception using
        errcode = '22023',
        message = 'Anonymous impressions require a visitor token';
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
    now(),
    date_trunc('hour', now())
  from public.novels n
  left join public.profiles p on p.id = n.user_id
  cross join public.novel_exposure_rules r
  where r.id = 1
    and n.status = 'published'
    and n.id::text = any(p_novel_ids)
  on conflict (
    viewer_key,
    surface,
    novel_id_snapshot,
    exposure_hour
  ) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$$;

revoke all on function public.record_novel_impressions(text, text[], text) from public;
grant execute on function public.record_novel_impressions(text, text[], text) to anon, authenticated;

commit;
