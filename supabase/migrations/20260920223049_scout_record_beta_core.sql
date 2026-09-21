-- NOVELIGHT Chapter 49: beta SCOUT RECORD core.
--
-- This migration exposes the already-recorded Scout XP safely to its owner,
-- adds the missing valid-read XP rule, enforces the beta Lv.30 XP cap, and
-- introduces an auditable Scout Point ledger.
--
-- IMPORTANT: this migration does not invent retroactive rewards.
-- Existing scout_xp_ledger rows remain valid Scout XP, but historical valid
-- reads receive no new XP here and historical events receive no Scout Point.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920223049'));

do $$
begin
  if to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.seed_discovery_state') is null then
    raise exception 'Chapter 38 SCOUT foundations are required';
  end if;

  if to_regclass('public.scout_level_thresholds') is not null
     or to_regclass('public.scout_point_ledger') is not null then
    raise exception 'Chapter 49 SCOUT beta core already exists or requires reconciliation';
  end if;
end
$$;

create table public.scout_level_thresholds (
  level smallint primary key check (level between 1 and 30),
  cumulative_xp integer not null unique check (cumulative_xp >= 0),
  rule_version text not null default 'beta-2026-09-21'
);

insert into public.scout_level_thresholds (level, cumulative_xp)
select
  level_value::smallint,
  case
    when level_value = 1 then 0
    else ((level_value - 1) * 50)
      + (10 * (level_value - 2) * (level_value - 1))
  end
from generate_series(1, 30) as level_value;

alter table public.scout_level_thresholds enable row level security;
revoke all on table public.scout_level_thresholds from public, anon, authenticated;

create table public.scout_point_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_event_id uuid references public.scout_event_ledger(id) on delete restrict,
  source_xp_id uuid references public.scout_xp_ledger(id) on delete restrict,
  seed_id uuid,
  point_kind text not null,
  point_value integer not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'pending', 'frozen', 'cancelled')),
  event_key text not null unique,
  reversal_of uuid references public.scout_point_ledger(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint scout_point_kind_length check (char_length(point_kind) between 1 and 80),
  constraint scout_point_event_key_length check (char_length(event_key) between 1 and 240),
  constraint scout_point_reasonable_value check (point_value between -1000000 and 1000000)
);

create index scout_point_user_recent_idx
  on public.scout_point_ledger (user_id, occurred_at desc);
create index scout_point_user_status_idx
  on public.scout_point_ledger (user_id, status, occurred_at desc);
create index scout_point_seed_idx
  on public.scout_point_ledger (seed_id)
  where seed_id is not null;

alter table public.scout_point_ledger enable row level security;
revoke all on table public.scout_point_ledger from public, anon, authenticated;

create or replace function public.novelight_scout_level_for_xp(p_xp bigint)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select max(t.level)
      from public.scout_level_thresholds t
      where t.cumulative_xp <= greatest(coalesce(p_xp, 0), 0)
    ),
    1
  )::smallint
$$;

revoke all on function public.novelight_scout_level_for_xp(bigint)
  from public, anon, authenticated;

create or replace function public.novelight_cap_scout_xp_beta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_current bigint;
  v_remaining bigint;
begin
  if new.xp_value <= 0 then
    return new;
  end if;

  select t.cumulative_xp into v_cap
  from public.scout_level_thresholds t
  where t.level = 30;

  select coalesce(sum(x.xp_value), 0)::bigint into v_current
  from public.scout_xp_ledger x
  where x.user_id = new.user_id;

  v_remaining := v_cap::bigint - greatest(v_current, 0);

  if v_remaining <= 0 then
    return null;
  end if;

  new.xp_value := least(new.xp_value::bigint, v_remaining)::integer;
  return new;
end
$$;

revoke all on function public.novelight_cap_scout_xp_beta()
  from public, anon, authenticated;

create trigger scout_xp_beta_level_cap
before insert on public.scout_xp_ledger
for each row execute function public.novelight_cap_scout_xp_beta();

create or replace function public.novelight_award_valid_read_scout_xp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := pg_catalog.timezone('Asia/Tokyo', new.occurred_at)::date;
  v_awarded_today integer;
begin
  if new.event_type <> 'valid_read'
     or new.user_id is null
     or new.novel_id_snapshot is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:valid-read-xp:' || new.user_id::text, 0)
  );

  if exists (
    select 1
    from public.scout_xp_ledger x
    join public.scout_event_ledger e on e.id = x.source_event_id
    where x.user_id = new.user_id
      and x.xp_kind = 'valid_read'
      and e.novel_id_snapshot = new.novel_id_snapshot
  ) then
    return new;
  end if;

  select count(*)::integer into v_awarded_today
  from public.scout_xp_ledger x
  where x.user_id = new.user_id
    and x.xp_kind = 'valid_read'
    and pg_catalog.timezone('Asia/Tokyo', x.occurred_at)::date = v_today;

  if v_awarded_today < 5 then
    insert into public.scout_xp_ledger (
      user_id, source_event_id, xp_kind, xp_value, rule_version, occurred_at
    ) values (
      new.user_id, new.id, 'valid_read', 2, 'chapter49-beta-v1', new.occurred_at
    )
    on conflict (user_id, source_event_id, xp_kind) do nothing;
  end if;

  return new;
end
$$;

revoke all on function public.novelight_award_valid_read_scout_xp()
  from public, anon, authenticated;

create trigger scout_event_valid_read_xp
after insert on public.scout_event_ledger
for each row execute function public.novelight_award_valid_read_scout_xp();

create or replace function public.novelight_award_level_up_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_total bigint;
  v_old_total bigint;
  v_old_level smallint;
  v_new_level smallint;
  v_level integer;
begin
  if new.xp_value <= 0 then
    return new;
  end if;

  select coalesce(sum(x.xp_value), 0)::bigint into v_new_total
  from public.scout_xp_ledger x
  where x.user_id = new.user_id;

  v_old_total := greatest(v_new_total - new.xp_value, 0);
  v_old_level := public.novelight_scout_level_for_xp(v_old_total);
  v_new_level := public.novelight_scout_level_for_xp(v_new_total);

  if v_new_level <= v_old_level then
    return new;
  end if;

  for v_level in (v_old_level + 1)..v_new_level loop
    insert into public.scout_point_ledger (
      user_id, source_xp_id, point_kind, point_value, status,
      event_key, occurred_at, metadata
    ) values (
      new.user_id,
      new.id,
      'level_up',
      5,
      'confirmed',
      'level_up:' || new.user_id::text || ':' || v_level::text,
      new.occurred_at,
      pg_catalog.jsonb_build_object(
        'level', v_level,
        'rule_version', 'chapter49-beta-v1'
      )
    )
    on conflict (event_key) do nothing;
  end loop;

  return new;
end
$$;

revoke all on function public.novelight_award_level_up_points()
  from public, anon, authenticated;

create trigger scout_xp_level_up_points
after insert on public.scout_xp_ledger
for each row execute function public.novelight_award_level_up_points();

create or replace function public.novelight_award_discovery_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank_at_seed integer;
  v_reached_rank integer;
  v_delta integer;
  v_target integer := 0;
  v_current integer := 0;
  v_award integer := 0;
begin
  if new.event_type <> 'light_seed_discovery'
     or new.user_id is null
     or new.seed_id is null then
    return new;
  end if;

  if coalesce(new.metadata->>'rank_at_seed', '') !~ '^[0-9]+$'
     or coalesce(new.metadata->>'reached_rank', '') !~ '^[0-9]+$' then
    return new;
  end if;

  v_rank_at_seed := (new.metadata->>'rank_at_seed')::integer;
  v_reached_rank := (new.metadata->>'reached_rank')::integer;
  v_delta := v_reached_rank - v_rank_at_seed;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:discovery-point:' || new.seed_id::text, 0)
  );

  if v_rank_at_seed = 5 and v_reached_rank = 6 then
    insert into public.scout_point_ledger (
      user_id, source_event_id, seed_id, point_kind, point_value, status,
      event_key, occurred_at, metadata
    ) values (
      new.user_id, new.id, new.seed_id, 'nova_prediction', 25, 'confirmed',
      'nova_prediction:' || new.seed_id::text,
      new.occurred_at,
      pg_catalog.jsonb_build_object(
        'rank_at_seed', v_rank_at_seed,
        'reached_rank', v_reached_rank,
        'rule_version', 'chapter49-beta-v1'
      )
    )
    on conflict (event_key) do nothing;
    return new;
  end if;

  v_target := case
    when v_delta >= 5 then 200
    when v_delta = 4 then 100
    when v_delta = 3 then 50
    when v_delta = 2 then 20
    else 0
  end;

  if v_target = 0 then
    return new;
  end if;

  select coalesce(sum(p.point_value), 0)::integer into v_current
  from public.scout_point_ledger p
  where p.user_id = new.user_id
    and p.seed_id = new.seed_id
    and p.point_kind = 'discovery'
    and p.status = 'confirmed';

  v_award := greatest(v_target - v_current, 0);
  if v_award = 0 then
    return new;
  end if;

  insert into public.scout_point_ledger (
    user_id, source_event_id, seed_id, point_kind, point_value, status,
    event_key, occurred_at, metadata
  ) values (
    new.user_id, new.id, new.seed_id, 'discovery', v_award, 'confirmed',
    'discovery:' || new.seed_id::text || ':' || v_target::text,
    new.occurred_at,
    pg_catalog.jsonb_build_object(
      'target_cumulative_points', v_target,
      'rank_at_seed', v_rank_at_seed,
      'reached_rank', v_reached_rank,
      'rank_delta', v_delta,
      'rule_version', 'chapter49-beta-v1'
    )
  )
  on conflict (event_key) do nothing;

  return new;
end
$$;

revoke all on function public.novelight_award_discovery_points()
  from public, anon, authenticated;

create trigger scout_event_discovery_points
after insert on public.scout_event_ledger
for each row execute function public.novelight_award_discovery_points();

create or replace function public.novelight_scout_record_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cap integer;
  v_raw_xp bigint;
  v_xp integer;
  v_level smallint;
  v_rank_tier smallint;
  v_current_threshold integer;
  v_next_threshold integer;
  v_points integer;
  v_pending integer;
  v_month_points integer;
  v_seed_count bigint;
  v_discovery_count bigint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select cumulative_xp into v_cap
  from public.scout_level_thresholds
  where level = 30;

  select coalesce(sum(x.xp_value), 0)::bigint into v_raw_xp
  from public.scout_xp_ledger x
  where x.user_id = v_uid;

  v_xp := least(greatest(v_raw_xp, 0), v_cap)::integer;
  v_level := public.novelight_scout_level_for_xp(v_xp);
  v_rank_tier := least(3, ((v_level - 1) / 10) + 1)::smallint;

  select cumulative_xp into v_current_threshold
  from public.scout_level_thresholds where level = v_level;

  if v_level < 30 then
    select cumulative_xp into v_next_threshold
    from public.scout_level_thresholds where level = v_level + 1;
  end if;

  select
    coalesce(sum(p.point_value) filter (where p.status = 'confirmed'), 0)::integer,
    coalesce(sum(p.point_value) filter (where p.status in ('pending', 'frozen')), 0)::integer,
    coalesce(sum(p.point_value) filter (
      where p.status = 'confirmed'
        and pg_catalog.timezone('Asia/Tokyo', p.occurred_at)::date
          >= pg_catalog.date_trunc('month', pg_catalog.timezone('Asia/Tokyo', pg_catalog.now()))::date
    ), 0)::integer
  into v_points, v_pending, v_month_points
  from public.scout_point_ledger p
  where p.user_id = v_uid;

  select count(*)::bigint into v_seed_count
  from public.light_seeds s where s.reader_id = v_uid;

  select count(*)::bigint into v_discovery_count
  from public.seed_discovery_state d
  where d.reader_id = v_uid
    and (
      d.best_rank_delta >= 2
      or (d.rank_at_seed = 5 and d.highest_rank_seen = 6)
    );

  return pg_catalog.jsonb_build_object(
    'level', v_level,
    'rank_tier', v_rank_tier,
    'total_xp', v_xp,
    'raw_recorded_xp', v_raw_xp,
    'level_floor_xp', v_current_threshold,
    'next_level_xp', v_next_threshold,
    'xp_into_level', greatest(v_xp - v_current_threshold, 0),
    'xp_for_next_level', case
      when v_next_threshold is null then 0
      else greatest(v_next_threshold - v_current_threshold, 0)
    end,
    'beta_level_max', v_level = 30,
    'point_balance', v_points,
    'pending_points', v_pending,
    'month_points', v_month_points,
    'light_seed_count', v_seed_count,
    'discovery_success_count', v_discovery_count,
    'rule_version', 'chapter49-beta-v1'
  );
end
$$;

revoke all on function public.novelight_scout_record_summary()
  from public, anon;
grant execute on function public.novelight_scout_record_summary()
  to authenticated;

create or replace function public.novelight_scout_point_history(p_limit integer default 30)
returns table (
  point_value integer,
  status text,
  point_kind text,
  reason text,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.point_value,
    p.status,
    p.point_kind,
    case p.point_kind
      when 'level_up' then 'Scout Level Up'
      when 'discovery' then '発掘成功'
      when 'nova_prediction' then 'NOVA予見'
      when 'badge' then 'Reader Badge'
      when 'reversal' then '報酬取消・調整'
      else 'Scout Point'
    end as reason,
    p.occurred_at
  from public.scout_point_ledger p
  where p.user_id = (select auth.uid())
  order by p.occurred_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

revoke all on function public.novelight_scout_point_history(integer)
  from public, anon;
grant execute on function public.novelight_scout_point_history(integer)
  to authenticated;

create or replace function public.novelight_scout_recent_activity(p_limit integer default 20)
returns table (
  event_type text,
  novel_id text,
  novel_title text,
  occurred_at timestamptz,
  seed_type text,
  reached_rank integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.event_type,
    e.novel_id_snapshot,
    case when n.status = 'published' then n.title else null end,
    e.occurred_at,
    e.metadata->>'seed_type',
    case
      when coalesce(e.metadata->>'reached_rank', '') ~ '^[0-9]+$'
        then (e.metadata->>'reached_rank')::integer
      else null
    end
  from public.scout_event_ledger e
  left join public.novels n on n.id::text = e.novel_id_snapshot
  where e.user_id = (select auth.uid())
    and e.event_type in (
      'valid_read',
      'light_seed_sent',
      'light_seed_discovery',
      'star_rating_set',
      'comment_posted'
    )
  order by e.occurred_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke all on function public.novelight_scout_recent_activity(integer)
  from public, anon;
grant execute on function public.novelight_scout_recent_activity(integer)
  to authenticated;

create or replace function public.novelight_scout_discoveries(p_limit integer default 20)
returns table (
  novel_id text,
  novel_title text,
  seed_type text,
  rank_at_seed smallint,
  highest_rank_seen smallint,
  best_rank_delta smallint,
  window_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.novel_id_snapshot,
    case when n.status = 'published' then n.title else null end,
    d.seed_type,
    d.rank_at_seed,
    d.highest_rank_seen,
    d.best_rank_delta,
    d.window_expires_at
  from public.seed_discovery_state d
  left join public.novels n on n.id::text = d.novel_id_snapshot
  where d.reader_id = (select auth.uid())
    and (
      d.best_rank_delta >= 2
      or (d.rank_at_seed = 5 and d.highest_rank_seen = 6)
    )
  order by d.updated_at desc, d.seed_id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke all on function public.novelight_scout_discoveries(integer)
  from public, anon;
grant execute on function public.novelight_scout_discoveries(integer)
  to authenticated;

commit;
