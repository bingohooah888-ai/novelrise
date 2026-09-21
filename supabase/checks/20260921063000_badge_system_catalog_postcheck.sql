\set ON_ERROR_STOP on

do $$
declare
  v_reader integer;
  v_reader_easy integer;
  v_reader_normal integer;
  v_reader_hard integer;
  v_author integer;
  v_author_easy integer;
  v_author_normal integer;
  v_author_hard integer;
  v_limited integer;
  v_settings jsonb;
begin
  select
    count(*) filter (where badge_category='reader' and enabled),
    count(*) filter (where badge_category='reader' and difficulty='easy' and enabled),
    count(*) filter (where badge_category='reader' and difficulty='normal' and enabled),
    count(*) filter (where badge_category='reader' and difficulty='hard' and enabled),
    count(*) filter (where badge_category='author' and enabled),
    count(*) filter (where badge_category='author' and difficulty='easy' and enabled),
    count(*) filter (where badge_category='author' and difficulty='normal' and enabled),
    count(*) filter (where badge_category='author' and difficulty='hard' and enabled),
    count(*) filter (where badge_category='limited' and enabled)
  into
    v_reader, v_reader_easy, v_reader_normal, v_reader_hard,
    v_author, v_author_easy, v_author_normal, v_author_hard, v_limited
  from public.scout_badge_definitions;

  if v_reader <> 100 or v_reader_easy <> 30
     or v_reader_normal <> 50 or v_reader_hard <> 20 then
    raise exception 'Reader Badge catalog count drift: total %, easy %, normal %, hard %',
      v_reader, v_reader_easy, v_reader_normal, v_reader_hard;
  end if;

  if v_author <> 40 or v_author_easy <> 5
     or v_author_normal <> 30 or v_author_hard <> 5 then
    raise exception 'Author Badge catalog count drift: total %, easy %, normal %, hard %',
      v_author, v_author_easy, v_author_normal, v_author_hard;
  end if;

  if v_limited <> 2 then
    raise exception 'Limited Badge baseline count drift: %', v_limited;
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions
     where badge_category='author'
       and enabled
       and point_reward <> 0
  ) then
    raise exception 'Author Badge must never award Scout Point';
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions
     where badge_category='reader'
       and difficulty='easy'
       and enabled
       and point_reward <> 1
  ) then
    raise exception 'Reader Easy Badge reward must be 1 Point';
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions
     where badge_category='reader'
       and difficulty='hard'
       and enabled
       and point_reward <> 25
  ) then
    raise exception 'Reader Hard Badge reward must be 25 Point';
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions
     where badge_id in ('reader_point_100','reader_point_500')
       and point_reward <> 0
  ) then
    raise exception 'Point-threshold Reader Badges must award 0 Point';
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions
     where badge_id in (
       'reader_discovery_plus2_005','reader_discovery_plus2_010',
       'reader_discovery_plus2_020','reader_discovery_plus3_001',
       'reader_discovery_plus3_005','reader_discovery_plus3_010',
       'reader_discovery_plus4_001','reader_discovery_plus4_002',
       'reader_discovery_plus4_005','reader_nova_001',
       'reader_nova_003','reader_nova_005','reader_level_030'
     )
       and point_reward <> 10
  ) then
    raise exception 'Normal important Reader Badge reward must be 10 Point';
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions
     where badge_category='reader'
       and difficulty='normal'
       and badge_id not in (
         'reader_discovery_plus2_005','reader_discovery_plus2_010',
         'reader_discovery_plus2_020','reader_discovery_plus3_001',
         'reader_discovery_plus3_005','reader_discovery_plus3_010',
         'reader_discovery_plus4_001','reader_discovery_plus4_002',
         'reader_discovery_plus4_005','reader_nova_001',
         'reader_nova_003','reader_nova_005','reader_level_030',
         'reader_point_100','reader_point_500'
       )
       and enabled
       and point_reward <> 5
  ) then
    raise exception 'Normal standard Reader Badge reward must be 5 Point';
  end if;

  if not exists (
    select 1
      from public.scout_badge_definitions
     where badge_id='reader_master_scout'
       and badge_category='reader'
       and difficulty='hard'
       and condition_type='composite_all'
       and target_value=4
       and point_reward=25
       and pg_catalog.jsonb_array_length(condition_config->'components')=4
       and enabled
  ) then
    raise exception 'Master Scout composite definition is incomplete';
  end if;

  if exists (
    select 1
      from public.scout_badge_definitions
     where badge_id ~ '^author_badge_[0-9]{3}$'
       and enabled
  ) then
    raise exception 'Legacy provisional Author Badge IDs must be disabled';
  end if;

  if exists (
    select 1
      from public.user_scout_badges
     where badge_id ~ '^author_badge_[0-9]{3}$'
  ) then
    raise exception 'Legacy per-user Author Badge aliases must be migrated to canonical IDs';
  end if;

  if not exists (
    select 1 from public.scout_badge_definitions
     where badge_id='author_novel_001' and enabled and point_reward=0
  ) or not exists (
    select 1 from public.scout_badge_definitions
     where badge_id='author_discovered_plus2_005' and enabled and point_reward=0
  ) then
    raise exception 'Canonical Author Badge endpoints are missing';
  end if;

  select badge_settings into v_settings
    from public.scout_badge_runtime_config where id=1;

  if coalesce((v_settings->>'new_author_days')::integer,0) <> 30
     or coalesce((v_settings->>'new_work_days')::integer,0) <> 7
     or coalesce((v_settings->>'low_rank_threshold')::integer,0) <> 2
     or coalesce((v_settings->>'long_chars')::integer,0) <> 100000
     or coalesce((v_settings->>'long_valid_episodes')::integer,0) <> 5
     or coalesce((v_settings->>'short_chars')::integer,0) <> 20000
     or coalesce((v_settings->>'completed_read_ratio')::numeric,0) <> 0.80 then
    raise exception 'Badge runtime settings drifted from beta configuration';
  end if;

  if not exists (
    select 1 from public.scout_badge_runtime_config
     where id=1
       and retroactive_policy='none'
       and reader_badges_activated_at is not null
  ) then
    raise exception 'Reader Badge activation/retroactive policy is incomplete';
  end if;

  if has_table_privilege('anon','public.scout_badge_definitions','select')
     or has_table_privilege('authenticated','public.scout_badge_definitions','select')
     or has_table_privilege('authenticated','public.user_scout_badges','select')
     or has_table_privilege('authenticated','public.scout_badge_metric_events','select') then
    raise exception 'Badge raw tables must remain RPC-only';
  end if;

  if to_regprocedure('public.novelight_reader_badge_metrics(uuid)') is null
     or to_regprocedure('public.novelight_author_badge_metrics(uuid)') is null
     or to_regprocedure('public.novelight_evaluate_scout_badge(text,jsonb)') is null
     or to_regprocedure('public.novelight_apply_scout_badge_evaluation(uuid,text,bigint,numeric,boolean,jsonb,boolean)') is null
     or to_regprocedure('public.novelight_refresh_scout_badges_for_user(uuid,boolean)') is null then
    raise exception 'Badge Metric/Condition/Progress/Reward Engine functions are incomplete';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname='scout_event_refresh_reader_badges' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
     where tgname='scout_discovery_refresh_reader_badges' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
     where tgname='scout_xp_refresh_reader_badges' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
     where tgname='scout_point_refresh_reader_badges' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
     where tgname='scout_comment_refresh_reader_badges' and not tgisinternal
  ) then
    raise exception 'Badge event refresh triggers are incomplete';
  end if;

  if exists (
    select 1
      from public.scout_point_ledger p
     where p.point_kind='badge'
       and p.metadata->>'rule_version'='badge-system-beta-2026-09-21'
       and p.occurred_at < (
         select reader_badges_activated_at
           from public.scout_badge_runtime_config
          where id=1
       )
  ) then
    raise exception 'Reader Badge Point was backfilled before activation';
  end if;
end
$$;
