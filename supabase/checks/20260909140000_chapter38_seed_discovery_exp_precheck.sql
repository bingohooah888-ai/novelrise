do $$
begin
  if to_regclass('public.seed_discovery_state') is null
     or to_regclass('public.novel_rank_events') is null
     or to_regclass('public.scout_event_ledger') is null
     or to_regclass('public.scout_xp_ledger') is null then
    raise exception 'Chapter 38 SCOUT/Rank foundations are required';
  end if;
  if to_regprocedure('public.novelight_process_seed_discovery(uuid)') is not null then
    raise exception 'discovery processor is already installed';
  end if;
end
$$;
