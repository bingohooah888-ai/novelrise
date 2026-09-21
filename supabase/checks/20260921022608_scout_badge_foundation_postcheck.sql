\set ON_ERROR_STOP on

do $$
declare
  v_author integer;
  v_reader integer;
  v_limited integer;
begin
  if to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_scout_badges') is null
     or to_regclass('public.scout_badge_metric_events') is null
     or to_regclass('public.scout_badge_metric_state') is null
     or to_regclass('public.scout_episode_badge_state') is null then
    raise exception 'SCOUT badge foundation tables are incomplete';
  end if;

  select
    count(*) filter (where badge_category = 'author'),
    count(*) filter (where badge_category = 'reader'),
    count(*) filter (where badge_category = 'limited')
  into v_author, v_reader, v_limited
  from public.scout_badge_definitions;

  if v_author <> 40 then
    raise exception 'Author Badge definition count drifted: %', v_author;
  end if;

  if v_limited <> 2 then
    raise exception 'Limited Badge baseline count drifted: %', v_limited;
  end if;

  if v_reader <> 0 then
    raise exception 'Reader Badge conditions were inserted without the recovered accepted 100-condition source';
  end if;

  if exists (
    select 1
    from public.scout_badge_definitions
    where badge_category = 'author'
      and point_reward <> 0
  ) then
    raise exception 'Author Badge must not award Scout Point';
  end if;

  if not exists (
    select 1 from public.scout_badge_runtime_config
    where id = 1 and retroactive_policy = 'none'
  ) then
    raise exception 'Badge retroactive policy must default to none';
  end if;

  if has_table_privilege('anon', 'public.scout_badge_definitions', 'select')
     or has_table_privilege('authenticated', 'public.scout_badge_definitions', 'select')
     or has_table_privilege('authenticated', 'public.user_scout_badges', 'select')
     or has_table_privilege('authenticated', 'public.scout_badge_metric_events', 'select') then
    raise exception 'SCOUT badge raw tables must remain RPC-only';
  end if;

  if to_regprocedure('public.novelight_scout_badges()') is null
     or to_regprocedure('public.novelight_refresh_my_scout_badges()') is null
     or to_regprocedure('public.novelight_set_scout_badge_visibility(text,boolean)') is null
     or to_regprocedure('public.novelight_public_scout_record(uuid)') is null then
    raise exception 'SCOUT badge RPCs are incomplete';
  end if;

  if has_function_privilege('anon', 'public.novelight_scout_badges()', 'execute')
     or not has_function_privilege('authenticated', 'public.novelight_scout_badges()', 'execute') then
    raise exception 'Owner badge RPC grants are incorrect';
  end if;

  if not has_function_privilege('anon', 'public.novelight_public_scout_record(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.novelight_public_scout_record(uuid)', 'execute') then
    raise exception 'Public SCOUT summary RPC grants are incorrect';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'scout_badge_track_author_work' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'scout_badge_track_author_episode' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'scout_badge_track_author_favorite' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'scout_badge_track_author_comment' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'scout_badge_track_author_unique_reader' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'scout_badge_track_author_seed' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'scout_badge_track_author_completion' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'scout_badge_track_author_seed_growth' and not tgisinternal
  ) then
    raise exception 'Author Badge metric triggers are incomplete';
  end if;
end
$$;
