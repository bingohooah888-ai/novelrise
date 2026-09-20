\set ON_ERROR_STOP on

do $$
declare
  v_threshold_count integer;
  v_cap integer;
begin
  if to_regclass('public.scout_level_thresholds') is null
     or to_regclass('public.scout_point_ledger') is null then
    raise exception 'Chapter 49 SCOUT beta core tables are missing';
  end if;

  select count(*), max(cumulative_xp)
    into v_threshold_count, v_cap
    from public.scout_level_thresholds;

  if v_threshold_count <> 30 or v_cap <> 9570 then
    raise exception 'Beta Scout Level thresholds are incomplete or cap drifted';
  end if;

  if exists (
    select 1
    from (
      select
        level,
        cumulative_xp,
        lag(cumulative_xp) over (order by level) as prior_xp
      from public.scout_level_thresholds
    ) q
    where q.prior_xp is not null
      and q.cumulative_xp <= q.prior_xp
  ) then
    raise exception 'Scout Level thresholds must be strictly increasing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'scout_point_ledger'
      and c.relrowsecurity
  ) then
    raise exception 'Scout Point ledger must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.scout_point_ledger', 'select')
     or has_table_privilege('authenticated', 'public.scout_point_ledger', 'select')
     or has_table_privilege('authenticated', 'public.scout_point_ledger', 'insert')
     or has_table_privilege('authenticated', 'public.scout_point_ledger', 'update')
     or has_table_privilege('authenticated', 'public.scout_point_ledger', 'delete') then
    raise exception 'Scout Point ledger must remain RPC-only and private';
  end if;

  if has_table_privilege('anon', 'public.scout_level_thresholds', 'select')
     or has_table_privilege('authenticated', 'public.scout_level_thresholds', 'select') then
    raise exception 'Scout Level threshold table must remain private';
  end if;

  if to_regprocedure('public.novelight_scout_record_summary()') is null
     or to_regprocedure('public.novelight_scout_point_history(integer)') is null
     or to_regprocedure('public.novelight_scout_recent_activity(integer)') is null
     or to_regprocedure('public.novelight_scout_discoveries(integer)') is null then
    raise exception 'SCOUT RECORD owner RPCs are incomplete';
  end if;

  if has_function_privilege('anon', 'public.novelight_scout_record_summary()', 'execute')
     or not has_function_privilege('authenticated', 'public.novelight_scout_record_summary()', 'execute') then
    raise exception 'SCOUT RECORD summary RPC grants are incorrect';
  end if;

  if has_function_privilege('anon', 'public.novelight_scout_point_history(integer)', 'execute')
     or has_function_privilege('anon', 'public.novelight_scout_recent_activity(integer)', 'execute')
     or has_function_privilege('anon', 'public.novelight_scout_discoveries(integer)', 'execute') then
    raise exception 'SCOUT RECORD detail RPCs must not be anonymous';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'scout_xp_beta_level_cap' and not tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'scout_event_valid_read_xp' and not tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'scout_xp_level_up_points' and not tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'scout_event_discovery_points' and not tgisinternal
  ) then
    raise exception 'Chapter 49 SCOUT triggers are incomplete';
  end if;

  if pg_catalog.strpos(
    pg_get_functiondef('public.novelight_award_valid_read_scout_xp()'::regprocedure),
    'v_awarded_today < 5'
  ) = 0 or pg_catalog.strpos(
    pg_get_functiondef('public.novelight_award_valid_read_scout_xp()'::regprocedure),
    '''valid_read'', 2'
  ) = 0 then
    raise exception 'Valid-read Scout XP rule drifted';
  end if;

  if pg_catalog.strpos(
    pg_get_functiondef('public.novelight_award_discovery_points()'::regprocedure),
    'when v_delta >= 5 then 200'
  ) = 0 or pg_catalog.strpos(
    pg_get_functiondef('public.novelight_award_discovery_points()'::regprocedure),
    '''nova_prediction'', 25'
  ) = 0 then
    raise exception 'Scout Point discovery rule drifted';
  end if;
end
$$;
