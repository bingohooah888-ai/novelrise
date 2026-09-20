begin;

do $$
declare
  v_state regprocedure := to_regprocedure('public.novelight_episode_heart_state(bigint)');
  v_toggle regprocedure := to_regprocedure('public.novelight_toggle_episode_heart(bigint)');
  v_def text;
begin
  if to_regclass('public.episode_hearts') is null or v_state is null or v_toggle is null then
    raise exception 'Episode hearts objects are missing';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'episode_hearts' and c.relrowsecurity
  ) then
    raise exception 'episode_hearts RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.episode_hearts', 'SELECT')
     or has_table_privilege('anon', 'public.episode_hearts', 'INSERT')
     or has_table_privilege('anon', 'public.episode_hearts', 'UPDATE')
     or has_table_privilege('anon', 'public.episode_hearts', 'DELETE')
     or has_table_privilege('authenticated', 'public.episode_hearts', 'SELECT')
     or has_table_privilege('authenticated', 'public.episode_hearts', 'INSERT')
     or has_table_privilege('authenticated', 'public.episode_hearts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.episode_hearts', 'DELETE') then
    raise exception 'episode_hearts has direct browser table grants';
  end if;

  if not has_function_privilege('anon', 'public.novelight_episode_heart_state(bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_episode_heart_state(bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_toggle_episode_heart(bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_toggle_episode_heart(bigint)', 'EXECUTE') then
    raise exception 'Episode heart RPC grants are incorrect';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.episode_hearts'::regclass
       and contype = 'p'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (episode_id, user_id)'
  ) then
    raise exception 'Episode heart uniqueness contract is missing';
  end if;

  if exists (
    select 1
      from pg_proc p
     where p.oid in (v_state::oid, v_toggle::oid)
       and (
         not p.prosecdef
         or p.proconfig is null
         or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=""%'
       )
  ) then
    raise exception 'Episode heart RPC security-definer search_path contract is invalid';
  end if;

  select lower(pg_get_functiondef(v_toggle::oid)) into v_def;
  if v_def ~ 'light_seed|scout|work_rank|novel_exposure|record_episode_pv|favorites' then
    raise exception 'Episode heart toggle must remain evaluation-neutral';
  end if;
end
$$;

rollback;
