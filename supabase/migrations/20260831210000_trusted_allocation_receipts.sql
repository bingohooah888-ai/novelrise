-- Make authoritative exposure writes depend on server-issued allocations.
begin;
select pg_advisory_xact_lock(hashtext('novelrise:20260831210000'));

create table public.novel_allocation_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  viewer_id uuid not null,
  novel_id_snapshot text not null,
  surface text not null check (surface in ('home_discovery', 'home_plan_extra', 'home_premium_slot', 'search_recommended')),
  author_id_snapshot uuid not null,
  plan_snapshot text not null check (plan_snapshot in ('free', 'standard', 'premium')),
  rule_version text not null,
  allocation_reason text not null check (allocation_reason in ('balanced', 'initial_exposure', 'plan_extra', 'premium_extra')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  check (expires_at > issued_at)
);
create index novel_allocation_receipts_expiry_idx on public.novel_allocation_receipts (expires_at);
revoke all on table public.novel_allocation_receipts from public, anon, authenticated;

create table public.neutral_search_impression_telemetry (
  viewer_key text not null,
  novel_id_snapshot text not null,
  exposed_at timestamptz not null default now(),
  exposure_hour timestamptz not null,
  primary key (viewer_key, novel_id_snapshot, exposure_hour)
);
revoke all on table public.neutral_search_impression_telemetry from public, anon, authenticated;

create or replace function public.novelight_trusted_discovery_feed(
  p_surface text, p_limit integer default 24, p_keyword text default null,
  p_genre text default null, p_visitor_token text default null
) returns table (
  feed_position integer, novel_id text, title text, genre text, description text,
  author_id uuid, author_plan text, created_at timestamptz, pv bigint,
  favorite_count bigint, is_premium_slot boolean, allocation_receipt uuid
) language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare v_uid uuid := (select auth.uid()); v_batch uuid := gen_random_uuid();
begin
  return query
  with allocated as materialized (
    select * from public.novelight_discovery_feed_v2(p_surface, p_limit, p_keyword, p_genre, p_visitor_token)
  ), issued as (
    insert into public.novel_allocation_receipts (
      batch_id, viewer_id, novel_id_snapshot, surface, author_id_snapshot,
      plan_snapshot, rule_version, allocation_reason
    )
    select v_batch, v_uid, a.novel_id,
      case when a.is_premium_slot then 'home_premium_slot' else p_surface end,
      a.author_id, a.author_plan, r.rule_version,
      case when a.is_premium_slot then 'premium_extra'
           when a.created_at >= now() - make_interval(days => r.initial_exposure_window_days)
            and (select count(*) from public.novel_exposure_events e where e.novel_id_snapshot = a.novel_id) < r.initial_exposure_target
           then 'initial_exposure' else 'balanced' end
    from allocated a cross join public.novel_exposure_rules r
    where r.id = 1 and v_uid is not null
    returning receipt_id, novel_id_snapshot, surface
  )
  select a.*, i.receipt_id
  from allocated a left join issued i on i.novel_id_snapshot = a.novel_id
    and i.surface = case when a.is_premium_slot then 'home_premium_slot' else p_surface end
  order by a.feed_position;
end $$;

create or replace function public.novelight_trusted_plan_extra_feed(
  p_limit integer default 1, p_exclude_novel_ids text[] default '{}'::text[],
  p_visitor_token text default null
) returns table (
  feed_position integer, novel_id text, title text, genre text, description text,
  author_id uuid, author_plan text, created_at timestamptz, pv bigint,
  favorite_count bigint, allocation_receipt uuid
) language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare v_uid uuid := (select auth.uid()); v_batch uuid := gen_random_uuid();
begin
  return query
  with allocated as materialized (
    select * from public.novelight_plan_extra_feed(p_limit, p_exclude_novel_ids, p_visitor_token)
  ), issued as (
    insert into public.novel_allocation_receipts (
      batch_id, viewer_id, novel_id_snapshot, surface, author_id_snapshot,
      plan_snapshot, rule_version, allocation_reason
    )
    select v_batch, v_uid, a.novel_id, 'home_plan_extra', a.author_id,
      a.author_plan, r.rule_version, 'plan_extra'
    from allocated a cross join public.novel_exposure_rules r
    where r.id = 1 and v_uid is not null
    returning receipt_id, novel_id_snapshot
  )
  select a.*, i.receipt_id from allocated a
  left join issued i on i.novel_id_snapshot = a.novel_id
  order by a.feed_position;
end $$;

create or replace function public.record_trusted_allocation_receipts(p_receipts uuid[])
returns integer language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare v_uid uuid := (select auth.uid()); v_inserted integer;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if p_receipts is null or cardinality(p_receipts) < 1 or cardinality(p_receipts) > 24
     or cardinality(p_receipts) <> cardinality(array(select distinct x from unnest(p_receipts) x)) then
    raise exception using errcode = '22023', message = 'Receipt batch must contain 1 to 24 unique receipts';
  end if;

  perform 1 from public.novel_allocation_receipts r
    where r.receipt_id = any(p_receipts) order by r.receipt_id for update;
  if (select count(*) from public.novel_allocation_receipts r
      where r.receipt_id = any(p_receipts) and r.viewer_id = v_uid
        and r.consumed_at is null and r.expires_at > now()) <> cardinality(p_receipts) then
    raise exception using errcode = '42501', message = 'Invalid, expired, foreign, or consumed allocation receipt';
  end if;

  insert into public.novel_exposure_events (
    viewer_key, viewer_id, surface, novel_id_snapshot, author_id_snapshot,
    plan_snapshot, rule_version, allocation_reason, exposed_at, exposure_hour
  ) select 'user:' || v_uid::text, v_uid, r.surface, r.novel_id_snapshot,
      r.author_id_snapshot, r.plan_snapshot, r.rule_version, r.allocation_reason,
      now(), date_trunc('hour', now())
    from public.novel_allocation_receipts r where r.receipt_id = any(p_receipts)
  on conflict (viewer_key, surface, novel_id_snapshot, exposure_hour) do nothing;
  get diagnostics v_inserted = row_count;
  update public.novel_allocation_receipts set consumed_at = now() where receipt_id = any(p_receipts);
  return v_inserted;
end $$;

create or replace function public.record_neutral_search_impressions(p_novel_ids text[], p_visitor_token text default null)
returns integer language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare v_uid uuid := (select auth.uid()); v_key text; v_inserted integer;
begin
  if p_novel_ids is null or cardinality(p_novel_ids) < 1 or cardinality(p_novel_ids) > 50 then
    raise exception using errcode = '22023', message = 'Search impression batch must contain between 1 and 50 works';
  end if;
  if v_uid is not null then v_key := 'user:' || v_uid::text;
  elsif p_visitor_token is not null and length(btrim(p_visitor_token)) between 8 and 128 then
    v_key := 'visitor:' || btrim(p_visitor_token);
  else raise exception using errcode = '22023', message = 'Anonymous telemetry requires a visitor token'; end if;
  insert into public.neutral_search_impression_telemetry (viewer_key, novel_id_snapshot, exposure_hour)
    select v_key, n.id::text, date_trunc('hour', now()) from public.novels n
    where n.status = 'published' and n.id::text = any(p_novel_ids)
    on conflict do nothing;
  get diagnostics v_inserted = row_count; return v_inserted;
end $$;

revoke all on function public.record_novel_impressions(text, text[], text) from anon, authenticated;
revoke all on function public.record_novel_impressions_v2(text, text[], text) from anon, authenticated;
revoke all on function public.novelight_trusted_discovery_feed(text, integer, text, text, text) from public;
revoke all on function public.novelight_trusted_plan_extra_feed(integer, text[], text) from public;
revoke all on function public.record_trusted_allocation_receipts(uuid[]) from public;
grant execute on function public.novelight_trusted_discovery_feed(text, integer, text, text, text) to anon, authenticated;
grant execute on function public.novelight_trusted_plan_extra_feed(integer, text[], text) to anon, authenticated;
grant execute on function public.record_trusted_allocation_receipts(uuid[]) to authenticated;
commit;
