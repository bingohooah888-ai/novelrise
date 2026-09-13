-- NOVELIGHT trusted public impression receipts for beta author funnel accounting.
-- Production application requires the approval-gated Supabase migration workflow.
--
-- Goal: make author-facing exposure accounting include anonymous readers and
-- public home/list shelves without restoring arbitrary client impression writes.
-- All new SECURITY DEFINER logic lives in the non-exposed private schema.

begin;
select pg_advisory_xact_lock(hashtext('novelight:trusted-public-impression-receipts'));

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

alter table public.novel_allocation_receipts
  add column if not exists viewer_key text;

update public.novel_allocation_receipts
set viewer_key = 'user:' || viewer_id::text
where viewer_key is null and viewer_id is not null;

alter table public.novel_allocation_receipts
  alter column viewer_id drop not null;

alter table public.novel_allocation_receipts
  drop constraint if exists novel_allocation_receipts_viewer_check;
alter table public.novel_allocation_receipts
  add constraint novel_allocation_receipts_viewer_check
  check (
    (
      viewer_id is not null
      and (viewer_key is null or viewer_key = 'user:' || viewer_id::text)
    )
    or (
      viewer_id is null
      and viewer_key like 'visitor:%'
      and length(viewer_key) between 16 and 136
    )
  );

alter table public.novel_allocation_receipts
  drop constraint if exists novel_allocation_receipts_surface_check;
alter table public.novel_allocation_receipts
  add constraint novel_allocation_receipts_surface_check
  check (surface in (
    'home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended',
    'home_new', 'home_seed', 'home_rank_unseen', 'home_rank_gathering',
    'search_new', 'search_seed'
  ));

alter table public.novel_allocation_receipts
  drop constraint if exists novel_allocation_receipts_allocation_reason_check;
alter table public.novel_allocation_receipts
  add constraint novel_allocation_receipts_allocation_reason_check
  check (allocation_reason in (
    'balanced', 'initial_exposure', 'plan_extra', 'premium_extra',
    'new_arrival', 'light_seed_discovery', 'rank_discovery'
  ));

alter table public.novel_exposure_events
  drop constraint if exists novel_exposure_events_surface_check;
alter table public.novel_exposure_events
  add constraint novel_exposure_events_surface_check
  check (surface in (
    'home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended',
    'search_results',
    'home_new', 'home_seed', 'home_rank_unseen', 'home_rank_gathering',
    'search_new', 'search_seed'
  ));

alter table public.novel_exposure_events
  drop constraint if exists novel_exposure_events_allocation_reason_check;
alter table public.novel_exposure_events
  add constraint novel_exposure_events_allocation_reason_check
  check (allocation_reason in (
    'balanced', 'initial_exposure', 'plan_extra', 'premium_extra',
    'new_arrival', 'light_seed_discovery', 'rank_discovery'
  ));

create or replace function private.novelight_trusted_discovery_feed_v2_impl(
  p_surface text,
  p_limit integer default 24,
  p_keyword text default null,
  p_genre text default null,
  p_visitor_token text default null
) returns table (
  feed_position integer, novel_id text, title text, genre text, description text,
  author_id uuid, author_plan text, created_at timestamptz, pv bigint,
  favorite_count bigint, is_premium_slot boolean, allocation_receipt uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_viewer_key text;
  v_batch uuid := gen_random_uuid();
begin
  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  elsif p_visitor_token is not null and length(btrim(p_visitor_token)) between 8 and 128 then
    v_viewer_key := 'visitor:' || btrim(p_visitor_token);
  else
    raise exception using errcode = '22023', message = 'Anonymous discovery requires a visitor token';
  end if;

  return query
  with allocated as materialized (
    select *
    from public.novelight_discovery_feed_v2(
      p_surface, p_limit, p_keyword, p_genre, p_visitor_token
    )
  ), issued as (
    insert into public.novel_allocation_receipts (
      batch_id, viewer_id, viewer_key, novel_id_snapshot, surface,
      author_id_snapshot, plan_snapshot, rule_version, allocation_reason
    )
    select
      v_batch,
      v_uid,
      v_viewer_key,
      a.novel_id,
      case when a.is_premium_slot then 'home_premium_slot' else p_surface end,
      a.author_id,
      a.author_plan,
      r.rule_version,
      case
        when a.is_premium_slot then 'premium_extra'
        when a.created_at >= now() - make_interval(days => r.initial_exposure_window_days)
          and (
            select count(*)
            from public.novel_exposure_events e
            where e.novel_id_snapshot = a.novel_id
          ) < r.initial_exposure_target
        then 'initial_exposure'
        else 'balanced'
      end
    from allocated a
    cross join public.novel_exposure_rules r
    where r.id = 1
    returning receipt_id, novel_id_snapshot, surface
  )
  select a.*, i.receipt_id
  from allocated a
  left join issued i
    on i.novel_id_snapshot = a.novel_id
   and i.surface = case when a.is_premium_slot then 'home_premium_slot' else p_surface end
  order by a.feed_position;
end
$$;

create or replace function public.novelight_trusted_discovery_feed_v2(
  p_surface text,
  p_limit integer default 24,
  p_keyword text default null,
  p_genre text default null,
  p_visitor_token text default null
) returns table (
  feed_position integer, novel_id text, title text, genre text, description text,
  author_id uuid, author_plan text, created_at timestamptz, pv bigint,
  favorite_count bigint, is_premium_slot boolean, allocation_receipt uuid
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.novelight_trusted_discovery_feed_v2_impl(
    p_surface, p_limit, p_keyword, p_genre, p_visitor_token
  )
$$;

create or replace function private.novelight_trusted_plan_extra_feed_v2_impl(
  p_limit integer default 1,
  p_exclude_novel_ids text[] default '{}'::text[],
  p_visitor_token text default null
) returns table (
  feed_position integer, novel_id text, title text, genre text, description text,
  author_id uuid, author_plan text, created_at timestamptz, pv bigint,
  favorite_count bigint, allocation_receipt uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_viewer_key text;
  v_batch uuid := gen_random_uuid();
begin
  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  elsif p_visitor_token is not null and length(btrim(p_visitor_token)) between 8 and 128 then
    v_viewer_key := 'visitor:' || btrim(p_visitor_token);
  else
    raise exception using errcode = '22023', message = 'Anonymous discovery requires a visitor token';
  end if;

  return query
  with allocated as materialized (
    select *
    from public.novelight_plan_extra_feed(
      p_limit, p_exclude_novel_ids, p_visitor_token
    )
  ), issued as (
    insert into public.novel_allocation_receipts (
      batch_id, viewer_id, viewer_key, novel_id_snapshot, surface,
      author_id_snapshot, plan_snapshot, rule_version, allocation_reason
    )
    select
      v_batch, v_uid, v_viewer_key, a.novel_id, 'home_plan_extra',
      a.author_id, a.author_plan, r.rule_version, 'plan_extra'
    from allocated a
    cross join public.novel_exposure_rules r
    where r.id = 1
    returning receipt_id, novel_id_snapshot
  )
  select a.*, i.receipt_id
  from allocated a
  left join issued i on i.novel_id_snapshot = a.novel_id
  order by a.feed_position;
end
$$;

create or replace function public.novelight_trusted_plan_extra_feed_v2(
  p_limit integer default 1,
  p_exclude_novel_ids text[] default '{}'::text[],
  p_visitor_token text default null
) returns table (
  feed_position integer, novel_id text, title text, genre text, description text,
  author_id uuid, author_plan text, created_at timestamptz, pv bigint,
  favorite_count bigint, allocation_receipt uuid
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.novelight_trusted_plan_extra_feed_v2_impl(
    p_limit, p_exclude_novel_ids, p_visitor_token
  )
$$;

create or replace function private.novelight_issue_visible_allocation_receipts_v2_impl(
  p_surface text,
  p_novel_ids text[],
  p_visitor_token text default null,
  p_offset integer default 0,
  p_rotation_key text default null
) returns table (novel_id text, allocation_receipt uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_viewer_key text;
  v_batch uuid := gen_random_uuid();
  v_eligible text[] := '{}'::text[];
  v_reason text;
  v_rank_group text;
begin
  if p_surface not in (
    'home_new', 'home_seed', 'home_rank_unseen', 'home_rank_gathering',
    'search_new', 'search_seed'
  ) then
    raise exception using errcode = '22023', message = 'Unsupported visible impression surface';
  end if;

  if p_novel_ids is null
     or cardinality(p_novel_ids) < 1
     or cardinality(p_novel_ids) > 24
     or cardinality(p_novel_ids) <>
       cardinality(array(select distinct x from unnest(p_novel_ids) as x)) then
    raise exception using errcode = '22023', message = 'Visible impression batch must contain 1 to 24 unique works';
  end if;

  if p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception using errcode = '22023', message = 'Invalid discovery offset';
  end if;

  if v_uid is not null then
    v_viewer_key := 'user:' || v_uid::text;
  elsif p_visitor_token is not null and length(btrim(p_visitor_token)) between 8 and 128 then
    v_viewer_key := 'visitor:' || btrim(p_visitor_token);
  else
    raise exception using errcode = '22023', message = 'Anonymous impression receipt requires a visitor token';
  end if;

  if p_surface in ('home_new', 'search_new') then
    select coalesce(array_agg(feed.novel_id), '{}'::text[])
      into v_eligible
    from public.novelight_neutral_search(
      null, null, 'new',
      case when p_surface = 'home_new' then 10 else 24 end,
      case when p_surface = 'home_new' then 0 else p_offset end
    ) as feed;
    v_reason := 'new_arrival';
  elsif p_surface in ('home_seed', 'search_seed') then
    select coalesce(array_agg(feed.novel_id), '{}'::text[])
      into v_eligible
    from public.novelight_light_seed_feed(
      24,
      case when p_surface = 'home_seed' then 0 else p_offset end
    ) as feed;
    v_reason := 'light_seed_discovery';
  else
    v_rank_group := case
      when p_surface = 'home_rank_unseen' then 'unseen'
      else 'gathering'
    end;
    if p_rotation_key is null or length(btrim(p_rotation_key)) < 8 then
      raise exception using errcode = '22023', message = 'Rank discovery receipt requires the rendered rotation key';
    end if;
    select coalesce(array_agg(feed.novel_id), '{}'::text[])
      into v_eligible
    from public.novelight_beta_rank_discovery_feed(
      v_rank_group, 12, left(p_rotation_key, 128)
    ) as feed;
    v_reason := 'rank_discovery';
  end if;

  if exists (
    select 1
    from unnest(p_novel_ids) as requested(novel_id)
    where not (requested.novel_id = any(v_eligible))
  ) then
    raise exception using errcode = '42501', message = 'One or more works are not eligible for the claimed rendered surface';
  end if;

  return query
  with requested as (
    select x.novel_id, x.ordinality
    from unnest(p_novel_ids) with ordinality as x(novel_id, ordinality)
  ), issued as (
    insert into public.novel_allocation_receipts (
      batch_id, viewer_id, viewer_key, novel_id_snapshot, surface,
      author_id_snapshot, plan_snapshot, rule_version, allocation_reason
    )
    select
      v_batch,
      v_uid,
      v_viewer_key,
      requested.novel_id,
      p_surface,
      novel.user_id,
      case lower(coalesce(profile.plan, 'free'))
        when 'standard' then 'standard'
        when 'premium' then 'premium'
        else 'free'
      end,
      rule.rule_version,
      v_reason
    from requested
    join public.novels as novel
      on novel.id::text = requested.novel_id
     and novel.status = 'published'
    left join public.profiles as profile on profile.id = novel.user_id
    cross join public.novel_exposure_rules as rule
    where rule.id = 1
    returning receipt_id, novel_id_snapshot
  )
  select requested.novel_id, issued.receipt_id
  from requested
  join issued on issued.novel_id_snapshot = requested.novel_id
  order by requested.ordinality;
end
$$;

create or replace function public.novelight_issue_visible_allocation_receipts_v2(
  p_surface text,
  p_novel_ids text[],
  p_visitor_token text default null,
  p_offset integer default 0,
  p_rotation_key text default null
) returns table (novel_id text, allocation_receipt uuid)
language sql
security invoker
set search_path = ''
as $$
  select * from private.novelight_issue_visible_allocation_receipts_v2_impl(
    p_surface, p_novel_ids, p_visitor_token, p_offset, p_rotation_key
  )
$$;

create or replace function private.record_trusted_allocation_receipts_v2_impl(
  p_receipts uuid[],
  p_visitor_token text default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_expected_viewer_key text;
  v_inserted integer;
begin
  if p_receipts is null
     or cardinality(p_receipts) < 1
     or cardinality(p_receipts) > 24
     or cardinality(p_receipts) <>
       cardinality(array(select distinct x from unnest(p_receipts) as x)) then
    raise exception using errcode = '22023', message = 'Receipt batch must contain 1 to 24 unique receipts';
  end if;

  if v_uid is not null then
    v_expected_viewer_key := 'user:' || v_uid::text;
  elsif p_visitor_token is not null and length(btrim(p_visitor_token)) between 8 and 128 then
    v_expected_viewer_key := 'visitor:' || btrim(p_visitor_token);
  else
    raise exception using errcode = '22023', message = 'Anonymous receipt consumption requires a visitor token';
  end if;

  perform 1
  from public.novel_allocation_receipts r
  where r.receipt_id = any(p_receipts)
  order by r.receipt_id
  for update;

  if (
    select count(*)
    from public.novel_allocation_receipts r
    where r.receipt_id = any(p_receipts)
      and r.consumed_at is null
      and r.expires_at > now()
      and r.viewer_key = v_expected_viewer_key
      and (
        (v_uid is not null and r.viewer_id = v_uid)
        or (v_uid is null and r.viewer_id is null)
      )
  ) <> cardinality(p_receipts) then
    raise exception using errcode = '42501', message = 'Invalid, expired, foreign, or consumed allocation receipt';
  end if;

  insert into public.novel_exposure_events (
    viewer_key, viewer_id, surface, novel_id_snapshot, author_id_snapshot,
    plan_snapshot, rule_version, allocation_reason, exposed_at, exposure_hour
  )
  select
    r.viewer_key,
    r.viewer_id,
    r.surface,
    r.novel_id_snapshot,
    r.author_id_snapshot,
    r.plan_snapshot,
    r.rule_version,
    r.allocation_reason,
    now(),
    date_trunc('hour', now())
  from public.novel_allocation_receipts r
  where r.receipt_id = any(p_receipts)
  on conflict (viewer_key, surface, novel_id_snapshot, exposure_hour) do nothing;

  get diagnostics v_inserted = row_count;

  update public.novel_allocation_receipts
  set consumed_at = now()
  where receipt_id = any(p_receipts);

  return v_inserted;
end
$$;

create or replace function public.record_trusted_allocation_receipts_v2(
  p_receipts uuid[],
  p_visitor_token text default null
) returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.record_trusted_allocation_receipts_v2_impl(
    p_receipts, p_visitor_token
  )
$$;

revoke all on function private.novelight_trusted_discovery_feed_v2_impl(text, integer, text, text, text) from public;
revoke all on function private.novelight_trusted_plan_extra_feed_v2_impl(integer, text[], text) from public;
revoke all on function private.novelight_issue_visible_allocation_receipts_v2_impl(text, text[], text, integer, text) from public;
revoke all on function private.record_trusted_allocation_receipts_v2_impl(uuid[], text) from public;

grant execute on function private.novelight_trusted_discovery_feed_v2_impl(text, integer, text, text, text) to anon, authenticated;
grant execute on function private.novelight_trusted_plan_extra_feed_v2_impl(integer, text[], text) to anon, authenticated;
grant execute on function private.novelight_issue_visible_allocation_receipts_v2_impl(text, text[], text, integer, text) to anon, authenticated;
grant execute on function private.record_trusted_allocation_receipts_v2_impl(uuid[], text) to anon, authenticated;

revoke all on function public.novelight_trusted_discovery_feed_v2(text, integer, text, text, text) from public;
revoke all on function public.novelight_trusted_plan_extra_feed_v2(integer, text[], text) from public;
revoke all on function public.novelight_issue_visible_allocation_receipts_v2(text, text[], text, integer, text) from public;
revoke all on function public.record_trusted_allocation_receipts_v2(uuid[], text) from public;

grant execute on function public.novelight_trusted_discovery_feed_v2(text, integer, text, text, text) to anon, authenticated;
grant execute on function public.novelight_trusted_plan_extra_feed_v2(integer, text[], text) to anon, authenticated;
grant execute on function public.novelight_issue_visible_allocation_receipts_v2(text, text[], text, integer, text) to anon, authenticated;
grant execute on function public.record_trusted_allocation_receipts_v2(uuid[], text) to anon, authenticated;

-- Preserve the existing v1 trusted-receipt API exactly as-is. Keep all generic
-- direct-write impression RPCs unavailable to browser roles and PUBLIC.
revoke all on function public.record_novel_impressions(text, text[], text) from public, anon, authenticated;
revoke all on function public.record_novel_impressions_v2(text, text[], text) from public, anon, authenticated;

commit;
