-- Postcheck for beta work-Rank discovery privacy policy.
do $$
declare
  v_rank_enabled integer;
  v_equipped_rank integer;
  v_process_definition text;
  v_recent_definition text;
  v_discovery_definition text;
begin
  if to_regprocedure('public.novelight_process_seed_discovery_rank_internal_20260928(uuid)') is null
     or to_regprocedure('public.novelight_reader_badge_metrics_rank_internal_20260928(uuid)') is null
     or to_regprocedure('public.novelight_author_badge_metrics_rank_internal_20260928(uuid)') is null
     or to_regprocedure('public.novelight_scout_record_summary_rank_internal_20260928()') is null then
    raise exception 'Original SCOUT implementations were not preserved';
  end if;

  select count(*) into v_rank_enabled
    from public.scout_badge_definitions d
   where d.enabled
     and (
       d.metadata->>'beta_rank_discovery_hidden' = 'true'
       or d.badge_id like 'reader_discovery_%'
       or d.badge_id like 'reader_nova_%'
       or d.badge_id like 'reader_low_rank_%'
       or d.badge_id like 'reader_gold_plus5_%'
       or d.badge_id like 'reader_silver_plus5_%'
       or d.badge_id like 'reader_bronze_plus5_%'
       or d.badge_id like 'author_discovered_%'
     );

  if v_rank_enabled <> 0 then
    raise exception 'Rank-dependent badge definitions remain enabled';
  end if;

  if not exists (
    select 1 from public.scout_badge_definitions
     where badge_id = 'reader_seed_001' and enabled
  ) or not exists (
    select 1 from public.scout_badge_definitions
     where badge_id = 'author_seed_received_001' and enabled
  ) then
    raise exception 'Normal LIGHT SEED badges must remain enabled';
  end if;

  select count(*) into v_equipped_rank
    from public.user_scout_badges b
    join public.scout_badge_definitions d on d.badge_id = b.badge_id
   where b.is_public
     and d.metadata->>'beta_rank_discovery_hidden' = 'true';

  if v_equipped_rank <> 0 then
    raise exception 'A hidden Rank-dependent title remains publicly equipped';
  end if;

  select pg_catalog.pg_get_functiondef('public.novelight_process_seed_discovery(uuid)'::regprocedure)
    into v_process_definition;
  if v_process_definition ilike '%insert into public.scout_xp_ledger%'
     or v_process_definition ilike '%light_seed_discovery:%' then
    raise exception 'Beta discovery processor still awards or records public discovery rewards';
  end if;

  select pg_catalog.pg_get_functiondef('public.novelight_scout_recent_activity(integer)'::regprocedure)
    into v_recent_definition;
  if v_recent_definition ilike '%''light_seed_discovery''%' then
    raise exception 'Recent activity still exposes discovery events';
  end if;

  select pg_catalog.pg_get_functiondef('public.novelight_scout_discoveries(integer)'::regprocedure)
    into v_discovery_definition;
  if v_discovery_definition not ilike '%where false%' then
    raise exception 'Discovery compatibility RPC is not fail-closed';
  end if;
end
$$;
