\set ON_ERROR_STOP on

-- NOVELIGHT authoritative PV counting postcheck.
do $$
declare
  v_proc oid := to_regprocedure('public.record_episode_pv(text,text)');
  v_old_novel oid := to_regprocedure('public.increment_novel_pv(bigint)');
  v_old_episode oid := to_regprocedure('public.increment_episode_pv(bigint)');
begin
  if to_regclass('public.episode_pv_events') is null then
    raise exception 'episode_pv_events is missing';
  end if;

  if not (
    select c.relrowsecurity
      from pg_class c
     where c.oid = 'public.episode_pv_events'::regclass
  ) then
    raise exception 'episode_pv_events RLS must be enabled';
  end if;

  if has_table_privilege('anon', 'public.episode_pv_events', 'SELECT')
     or has_table_privilege('anon', 'public.episode_pv_events', 'INSERT')
     or has_table_privilege('anon', 'public.episode_pv_events', 'UPDATE')
     or has_table_privilege('anon', 'public.episode_pv_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.episode_pv_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.episode_pv_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.episode_pv_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.episode_pv_events', 'DELETE') then
    raise exception 'Browser roles must not access raw PV event rows';
  end if;

  if v_proc is null then
    raise exception 'record_episode_pv(text,text) is missing';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = v_proc) then
    raise exception 'record_episode_pv must remain SECURITY DEFINER';
  end if;

  if not has_function_privilege('anon', v_proc, 'EXECUTE')
     or not has_function_privilege('authenticated', v_proc, 'EXECUTE') then
    raise exception 'Browser roles must execute the guarded PV RPC';
  end if;

  if v_old_novel is not null
     and (has_function_privilege('anon', v_old_novel, 'EXECUTE')
          or has_function_privilege('authenticated', v_old_novel, 'EXECUTE')) then
    raise exception 'Legacy novel PV RPC is still browser-callable';
  end if;

  if v_old_episode is not null
     and (has_function_privilege('anon', v_old_episode, 'EXECUTE')
          or has_function_privilege('authenticated', v_old_episode, 'EXECUTE')) then
    raise exception 'Legacy episode PV RPC is still browser-callable';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'episode_pv_events'
       and indexname = 'episode_pv_events_viewer_episode_time_idx'
  ) then
    raise exception 'PV six-hour lookup index is missing';
  end if;
end
$$;
