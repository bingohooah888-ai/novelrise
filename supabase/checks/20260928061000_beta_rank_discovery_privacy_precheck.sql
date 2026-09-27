-- Precheck for beta work-Rank discovery privacy policy.
do $$
begin
  if to_regclass('public.scout_badge_definitions') is null
     or to_regclass('public.user_scout_badges') is null
     or to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null
     or to_regclass('public.scout_point_ledger') is null
     or to_regclass('public.seed_discovery_state') is null then
    raise exception 'SCOUT RECORD foundations are missing';
  end if;

  if to_regprocedure('public.novelight_process_seed_discovery(uuid)') is null
     or to_regprocedure('public.novelight_reader_badge_metrics(uuid)') is null
     or to_regprocedure('public.novelight_author_badge_metrics(uuid)') is null
     or to_regprocedure('public.novelight_scout_record_summary()') is null
     or to_regprocedure('public.novelight_scout_recent_activity(integer)') is null
     or to_regprocedure('public.novelight_scout_discoveries(integer)') is null then
    raise exception 'Canonical SCOUT functions are missing';
  end if;

  if to_regprocedure('public.novelight_process_seed_discovery_rank_internal_20260928(uuid)') is not null then
    raise exception 'Beta work-Rank privacy migration appears already applied';
  end if;
end
$$;
