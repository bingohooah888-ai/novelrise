do $$
begin
  if to_regprocedure('public.novelight_process_seed_discovery(uuid)') is null then
    raise exception 'discovery processor is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'novel_rank_events_process_seed_discovery' and not tgisinternal) then
    raise exception 'discovery trigger is missing';
  end if;
  if has_function_privilege('anon', 'public.novelight_process_seed_discovery(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.novelight_process_seed_discovery(uuid)', 'execute') then
    raise exception 'browser roles can execute discovery processor';
  end if;
  if not has_function_privilege('service_role', 'public.novelight_process_seed_discovery(uuid)', 'execute') then
    raise exception 'service_role cannot execute discovery processor';
  end if;
  if has_table_privilege('anon', 'public.seed_discovery_state', 'select')
     or has_table_privilege('authenticated', 'public.seed_discovery_state', 'select') then
    raise exception 'discovery state is exposed to browser roles';
  end if;
  if has_function_privilege('authenticated', 'public.novelight_recalculate_work_ranks(timestamptz)', 'execute') then
    raise exception 'Rank recalculation is exposed to authenticated clients';
  end if;
end
$$;
