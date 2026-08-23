-- Lossless rollback for the exposure retention/favorite funnel expansion.
-- This rollback intentionally refuses to discard analytics data that the prior
-- schema cannot represent. If new favorite or multi-episode data already exists,
-- stop and use a deliberate forward migration instead of silently deleting it.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823133000'));

do $$
begin
  if exists (
    select 1
    from public.novel_exposure_conversions
    where event_type = 'favorite_added'
  ) then
    raise exception 'Lossless rollback blocked: favorite_added analytics already exist';
  end if;

  if exists (
    select 1
    from public.novel_exposure_conversions
    where event_type = 'episode_read_10s'
    group by exposure_id
    having count(*) > 1
  ) then
    raise exception 'Lossless rollback blocked: multiple per-episode read events already exist';
  end if;
end
$$;

drop index if exists public.novel_exposure_conversion_detail_once_idx;
drop index if exists public.novel_exposure_conversion_favorite_once_idx;
drop index if exists public.novel_exposure_conversion_episode_once_idx;

alter table public.novel_exposure_conversions
  drop constraint if exists novel_exposure_conversion_episode_number_check;

alter table public.novel_exposure_conversions
  drop constraint novel_exposure_conversions_event_type_check;

alter table public.novel_exposure_conversions
  drop constraint novel_exposure_episode_requirement;

alter table public.novel_exposure_conversions
  drop column episode_number_snapshot;

alter table public.novel_exposure_conversions
  add constraint novel_exposure_conversions_event_type_check
  check (event_type in ('detail_open', 'episode_read_10s'));

alter table public.novel_exposure_conversions
  add constraint novel_exposure_episode_requirement check (
    (event_type = 'detail_open' and episode_id_snapshot is null)
    or (event_type = 'episode_read_10s' and episode_id_snapshot is not null)
  );

alter table public.novel_exposure_conversions
  add constraint novel_exposure_conversion_once unique (exposure_id, event_type);

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
  v_inserted integer := 0;
begin
  if p_event_type not in ('detail_open', 'episode_read_10s') then
    raise exception using
      errcode = '22023',
      message = 'Unsupported exposure conversion event';
  end if;

  if p_novel_id is null or btrim(p_novel_id) = '' then
    raise exception using
      errcode = '22023',
      message = 'A novel identifier is required';
  end if;

  if p_event_type = 'detail_open' and p_episode_id is not null then
    raise exception using
      errcode = '22023',
      message = 'detail_open must not include an episode identifier';
  end if;

  if p_event_type = 'episode_read_10s'
     and (p_episode_id is null or btrim(p_episode_id) = '') then
    raise exception using
      errcode = '22023',
      message = 'episode_read_10s requires an episode identifier';
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

  if v_uid is not null and v_uid = v_author_id then
    return false;
  end if;

  if p_event_type = 'episode_read_10s' and not exists (
    select 1
    from public.episodes e
    where e.id::text = p_episode_id
      and e.novel_id::text = p_novel_id
      and e.status = 'published'
  ) then
    raise exception using
      errcode = '23514',
      message = 'The episode is not a published episode of this work';
  end if;

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
    converted_at
  ) values (
    v_exposure_id,
    v_viewer_key,
    p_novel_id,
    v_author_id,
    p_event_type,
    case when p_event_type = 'episode_read_10s' then p_episode_id else null end,
    now()
  )
  on conflict (exposure_id, event_type) do nothing;

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
  aggregate_rows as (
    select
      e.novel_id_snapshot,
      count(distinct e.id)::bigint as impressions,
      count(c.id) filter (where c.event_type = 'detail_open')::bigint as detail_opens,
      count(c.id) filter (where c.event_type = 'episode_read_10s')::bigint as body_reads,
      count(distinct e.id) filter (where e.surface = 'home_premium_slot')::bigint as premium_impressions,
      count(c.id) filter (
        where e.surface = 'home_premium_slot'
          and c.event_type = 'detail_open'
      )::bigint as premium_details,
      count(c.id) filter (
        where e.surface = 'home_premium_slot'
          and c.event_type = 'episode_read_10s'
      )::bigint as premium_reads
    from owned_exposures e
    left join public.novel_exposure_conversions c on c.exposure_id = e.id
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
