\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.scout_event_ledger') is null then
    raise exception 'SCOUT event ledger is missing';
  end if;

  if to_regclass('public.scout_xp_ledger') is null then
    raise exception 'Scout XP ledger is missing';
  end if;

  if to_regclass('public.seed_discovery_state') is null then
    raise exception 'LIGHT SEED discovery state is missing';
  end if;

  if to_regprocedure('public.record_valid_read_progress(text,uuid,double precision,integer,integer)') is null then
    raise exception 'Valid-read runtime is missing';
  end if;

  if to_regprocedure('public.novelight_process_seed_discovery(uuid)') is null then
    raise exception 'Discovery XP runtime is missing';
  end if;

  if to_regclass('public.scout_level_thresholds') is not null
     or to_regclass('public.scout_point_ledger') is not null then
    raise exception 'Chapter 49 SCOUT beta core already exists; reconcile before apply';
  end if;

  if to_regprocedure('public.novelight_scout_record_summary()') is not null
     or to_regprocedure('public.novelight_scout_point_history(integer)') is not null
     or to_regprocedure('public.novelight_scout_recent_activity(integer)') is not null
     or to_regprocedure('public.novelight_scout_discoveries(integer)') is not null then
    raise exception 'SCOUT RECORD owner RPC already exists; reconcile before apply';
  end if;
end
$$;
