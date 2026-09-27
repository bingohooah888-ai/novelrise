-- NOVELIGHT beta SCOUT RECORD: keep work Rank discovery private until Rank is public.
--
-- Beta contract:
-- - LIGHT SEED sending continues to count toward normal SEED badges and history.
-- - Work-Rank discovery remains internal state only.
-- - Rank-discovery badges, XP, Scout Point and user-facing Rank discovery history are suppressed.
-- - Existing ledgers are preserved for audit/future release; public beta totals filter Rank-derived rows.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260928061000'));

do $$
begin
  if to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_scout_badges') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.seed_discovery_state') is null then
    raise exception 'SCOUT RECORD beta foundations are required';
  end if;

  if to_regprocedure('public.novelight_reader_badge_metrics(uuid)') is null
     or to_regprocedure('public.novelight_author_badge_metrics(uuid)') is null then
    raise exception 'Canonical badge metric functions are required';
  end if;
end
$$;

-- Rank-dependent titles stay defined for the formal release, but are disabled in beta.
-- Store their former enabled state in metadata so the policy can be reversed explicitly.
update public.scout_badge_definitions d
   set metadata = coalesce(d.metadata, '{}'::jsonb)
         || pg_catalog.jsonb_build_object(
              'beta_rank_discovery_hidden', true,
              'beta_rank_previous_enabled', d.enabled
            ),
       enabled = false,
       updated_at = now()
 where (
       d.metric_key in (
         'discovery_plus2_count',
         'discovery_plus3_count',
         'discovery_plus4_count',
         'discovery_plus5_count',
         'nova_prediction_count',
         'gold_plus5_count',
         'silver_plus5_count',
         'bronze_plus5_count',
         'low_rank_read_count',
         'author_seed_growth_plus2_works',
         'author_seed_growth_plus3_works'
       )
       or d.badge_id like 'reader_discovery_%'
       or d.badge_id like 'reader_nova_%'
       or d.badge_id like 'reader_low_rank_%'
       or d.badge_id like 'reader_gold_plus5_%'
       or d.badge_id like 'reader_silver_plus5_%'
       or d.badge_id like 'reader_bronze_plus5_%'
       or d.badge_id like 'author_discovered_%'
       or exists (
         select 1
           from pg_catalog.jsonb_array_elements(
             case
               when pg_catalog.jsonb_typeof(d.condition_config->'components') = 'array'
                 then d.condition_config->'components'
               else '[]'::jsonb
             end
           ) component
          where component->>'metric_key' in (
            'discovery_plus2_count',
            'discovery_plus3_count',
            'discovery_plus4_count',
            'discovery_plus5_count',
            'nova_prediction_count',
            'gold_plus5_count',
            'silver_plus5_count',
            'bronze_plus5_count',
            'low_rank_read_count',
            'author_seed_growth_plus2_works',
            'author_seed_growth_plus3_works'
          )
       )
     )
   and coalesce((d.metadata->>'beta_rank_discovery_hidden')::boolean, false) = false;

-- If a Rank-dependent title happened to be equipped before this beta policy,
-- remove it from the public profile without deleting the earned/progress evidence.
update public.user_scout_badges b
   set metadata = coalesce(b.metadata, '{}'::jsonb)
         || pg_catalog.jsonb_build_object(
              'beta_rank_previous_is_public', b.is_public,
              'beta_rank_discovery_hidden', true
            ),
       is_public = false,
       updated_at = now()
 where exists (
   select 1
     from public.scout_badge_definitions d
    where d.badge_id = b.badge_id
      and d.metadata->>'beta_rank_discovery_hidden' = 'true'
 );

-- Central classifier for Scout Point rows that were caused by private work-Rank discovery.
create or replace function public.novelight_beta_rank_point_is_hidden(
  p_point_kind text,
  p_source_xp_id uuid,
  p_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(p_point_kind, '') in ('discovery', 'nova_prediction')
    or (
      p_point_kind = 'level_up'
      and exists (
        select 1
          from public.scout_xp_ledger x
         where x.id = p_source_xp_id
           and x.xp_kind = 'light_seed_discovery'
      )
    )
    or (
      p_point_kind = 'badge'
      and exists (
        select 1
          from public.scout_badge_definitions d
         where d.badge_id = coalesce(p_metadata->>'badge_id', '')
           and d.metadata->>'beta_rank_discovery_hidden' = 'true'
      )
    )
$$;

revoke all on function public.novelight_beta_rank_point_is_hidden(text, uuid, jsonb)
  from public, anon, authenticated;

-- Discovery state is still updated internally so the formal release can make an
-- explicit decision about historical Rank growth. Beta creates no discovery event or XP.
create or replace function public.novelight_process_seed_discovery(p_rank_event_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rank_event public.novel_rank_events%rowtype;
  v_seed public.seed_discovery_state%rowtype;
begin
  select * into v_rank_event
    from public.novel_rank_events
   where id = p_rank_event_id;

  if not found then
    return;
  end if;

  for v_seed in
    select s.*
      from public.seed_discovery_state s
     where s.novel_id_snapshot = v_rank_event.novel_id_snapshot
       and v_rank_event.occurred_at >= s.window_expires_at - interval '180 days'
       and v_rank_event.occurred_at <= s.window_expires_at
       and v_rank_event.to_rank > s.highest_rank_seen
     order by s.seed_id
     for update
  loop
    update public.seed_discovery_state
       set highest_rank_seen = greatest(highest_rank_seen, v_rank_event.to_rank),
           best_rank_delta = greatest(best_rank_delta, v_rank_event.to_rank - rank_at_seed),
           updated_at = now()
     where seed_id = v_seed.seed_id;
  end loop;
end
$$;

revoke all on function public.novelight_process_seed_discovery(uuid)
  from public, anon, authenticated;
grant execute on function public.novelight_process_seed_discovery(uuid) to service_role;

-- Keep the existing trigger contract but make discovery Point awarding a beta no-op.
create or replace function public.novelight_award_discovery_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end
$$;

revoke all on function public.novelight_award_discovery_points()
  from public, anon, authenticated;

-- Discovery XP must neither be inserted through an alternate path nor consume the
-- Lv.30 beta cap. Normal reading/rating/comment/SEED XP keeps working as before.
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
  if new.xp_kind = 'light_seed_discovery' then
    return null;
  end if;

  if new.xp_value <= 0 then
    return new;
  end if;

  select t.cumulative_xp into v_cap
    from public.scout_level_thresholds t
   where t.level = 30;

  select coalesce(sum(x.xp_value), 0)::bigint into v_current
    from public.scout_xp_ledger x
   where x.user_id = new.user_id
     and x.xp_kind <> 'light_seed_discovery';

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
  if new.xp_value <= 0 or new.xp_kind = 'light_seed_discovery' then
    return new;
  end if;

  select coalesce(sum(x.xp_value), 0)::bigint into v_new_total
    from public.scout_xp_ledger x
   where x.user_id = new.user_id
     and x.xp_kind <> 'light_seed_discovery';

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
        'rule_version', 'chapter49-beta-rank-private-v1'
      )
    )
    on conflict (event_key) do nothing;
  end loop;

  return new;
end
$$;

revoke all on function public.novelight_award_level_up_points()
  from public, anon, authenticated;

-- Keep the authoritative badge metric implementations internally, but mask every
-- work-Rank-derived metric before badge evaluation. This also prevents hidden XP/
-- Point from indirectly advancing Scout Level/Point threshold titles.
alter function public.novelight_reader_badge_metrics(uuid)
  rename to novelight_reader_badge_metrics_rank_internal_20260928;

create or replace function public.novelight_reader_badge_metrics(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metrics jsonb;
  v_visible_xp bigint := 0;
  v_visible_level smallint := 1;
  v_visible_points bigint := 0;
begin
  v_metrics := public.novelight_reader_badge_metrics_rank_internal_20260928(p_user_id);

  select coalesce(sum(x.xp_value), 0)::bigint into v_visible_xp
    from public.scout_xp_ledger x
   where x.user_id = p_user_id
     and x.xp_kind <> 'light_seed_discovery';

  v_visible_level := public.novelight_scout_level_for_xp(greatest(v_visible_xp, 0));

  select coalesce(sum(p.point_value) filter (
           where p.status = 'confirmed'
             and p.point_value > 0
             and not public.novelight_beta_rank_point_is_hidden(
               p.point_kind, p.source_xp_id, p.metadata
             )
         ), 0)::bigint
    into v_visible_points
    from public.scout_point_ledger p
   where p.user_id = p_user_id;

  return coalesce(v_metrics, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'discovery_plus2_count', 0,
      'discovery_plus3_count', 0,
      'discovery_plus4_count', 0,
      'discovery_plus5_count', 0,
      'nova_prediction_count', 0,
      'gold_plus5_count', 0,
      'silver_plus5_count', 0,
      'bronze_plus5_count', 0,
      'low_rank_read_count', 0,
      'scout_level', v_visible_level,
      'scout_point_earned_total', v_visible_points
    );
end
$$;

revoke all on function public.novelight_reader_badge_metrics(uuid)
  from public, anon, authenticated;

alter function public.novelight_author_badge_metrics(uuid)
  rename to novelight_author_badge_metrics_rank_internal_20260928;

create or replace function public.novelight_author_badge_metrics(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metrics jsonb;
begin
  v_metrics := public.novelight_author_badge_metrics_rank_internal_20260928(p_user_id);
  return coalesce(v_metrics, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'author_seed_growth_plus2_works', 0,
      'author_seed_growth_plus3_works', 0
    );
end
$$;

revoke all on function public.novelight_author_badge_metrics(uuid)
  from public, anon, authenticated;

-- Public beta summary excludes all work-Rank-derived XP/Point and never reports a
-- discovery-success count. Scout Rank/Level here is the reader's own Scout Rank.
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
  v_xp bigint;
  v_level smallint;
  v_rank_tier smallint;
  v_current_threshold integer;
  v_next_threshold integer;
  v_points integer;
  v_pending integer;
  v_month_points integer;
  v_seed_count bigint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select cumulative_xp into v_cap
    from public.scout_level_thresholds
   where level = 30;

  select coalesce(sum(x.xp_value), 0)::bigint into v_xp
    from public.scout_xp_ledger x
   where x.user_id = v_uid
     and x.xp_kind <> 'light_seed_discovery';

  v_xp := least(greatest(v_xp, 0), v_cap);
  v_level := public.novelight_scout_level_for_xp(v_xp);
  v_rank_tier := least(3, ((v_level - 1) / 10) + 1)::smallint;

  select cumulative_xp into v_current_threshold
    from public.scout_level_thresholds where level = v_level;

  if v_level < 30 then
    select cumulative_xp into v_next_threshold
      from public.scout_level_thresholds where level = v_level + 1;
  end if;

  select
    coalesce(sum(p.point_value) filter (
      where p.status = 'confirmed'
        and not public.novelight_beta_rank_point_is_hidden(
          p.point_kind, p.source_xp_id, p.metadata
        )
    ), 0)::integer,
    coalesce(sum(p.point_value) filter (
      where p.status in ('pending', 'frozen')
        and not public.novelight_beta_rank_point_is_hidden(
          p.point_kind, p.source_xp_id, p.metadata
        )
    ), 0)::integer,
    coalesce(sum(p.point_value) filter (
      where p.status = 'confirmed'
        and not public.novelight_beta_rank_point_is_hidden(
          p.point_kind, p.source_xp_id, p.metadata
        )
        and pg_catalog.timezone('Asia/Tokyo', p.occurred_at)::date
          >= pg_catalog.date_trunc('month', pg_catalog.timezone('Asia/Tokyo', pg_catalog.now()))::date
    ), 0)::integer
  into v_points, v_pending, v_month_points
  from public.scout_point_ledger p
  where p.user_id = v_uid;

  select count(*)::bigint into v_seed_count
    from public.light_seeds s where s.reader_id = v_uid;

  return pg_catalog.jsonb_build_object(
    'level', v_level,
    'rank_tier', v_rank_tier,
    'total_xp', v_xp,
    'raw_recorded_xp', v_xp,
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
    'discovery_success_count', 0,
    'rank_discovery_public', false,
    'rule_version', 'chapter49-beta-rank-private-v1'
  );
end
$$;

revoke all on function public.novelight_scout_record_summary()
  from public, anon;
grant execute on function public.novelight_scout_record_summary()
  to authenticated;

-- Point history keeps normal rewards, while hiding direct and indirect Rank rewards.
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
      when 'badge' then '読者称号'
      when 'reversal' then '報酬取消・調整'
      else 'Scout Point'
    end as reason,
    p.occurred_at
  from public.scout_point_ledger p
  where p.user_id = (select auth.uid())
    and not public.novelight_beta_rank_point_is_hidden(
      p.point_kind, p.source_xp_id, p.metadata
    )
  order by p.occurred_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

revoke all on function public.novelight_scout_point_history(integer)
  from public, anon;
grant execute on function public.novelight_scout_point_history(integer)
  to authenticated;

-- Recent activity never exposes work Rank or a discovery-success event in beta.
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
    null::integer as reached_rank
  from public.scout_event_ledger e
  left join public.novels n on n.id::text = e.novel_id_snapshot
  where e.user_id = (select auth.uid())
    and e.event_type in (
      'valid_read',
      'light_seed_sent',
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

-- Compatibility RPC remains callable so older clients fail closed with an empty list.
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
    null::text,
    null::text,
    null::text,
    null::smallint,
    null::smallint,
    null::smallint,
    null::timestamptz
  where false
$$;

revoke all on function public.novelight_scout_discoveries(integer)
  from public, anon;
grant execute on function public.novelight_scout_discoveries(integer)
  to authenticated;

comment on function public.novelight_scout_discoveries(integer) is
  'Beta compatibility endpoint. Work-Rank discovery is private and returns no rows.';

commit;
