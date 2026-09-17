-- Read-only postcheck for 20260917143000_episode_revision_history.sql

do $$
declare
  v_rls boolean;
begin
  if to_regclass('public.episode_revisions') is null then
    raise exception 'postcheck failed: public.episode_revisions is missing';
  end if;

  select c.relrowsecurity
    into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'episode_revisions';
  if v_rls is distinct from true then
    raise exception 'postcheck failed: episode_revisions RLS is disabled';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'episode_revision_history_before_update'
       and not tgisinternal
  ) then
    raise exception 'postcheck failed: revision trigger is missing';
  end if;

  if to_regprocedure('public.novelight_list_episode_revisions(bigint)') is null
     or to_regprocedure('public.novelight_get_episode_revision(uuid)') is null
     or to_regprocedure('public.novelight_restore_episode_revision(bigint,uuid)') is null then
    raise exception 'postcheck failed: revision RPC is missing';
  end if;

  if has_table_privilege('anon', 'public.episode_revisions', 'SELECT')
     or has_table_privilege('authenticated', 'public.episode_revisions', 'SELECT') then
    raise exception 'postcheck failed: revision table is directly readable by clients';
  end if;

  if has_function_privilege('anon', 'public.novelight_list_episode_revisions(bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_get_episode_revision(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_restore_episode_revision(bigint,uuid)', 'EXECUTE') then
    raise exception 'postcheck failed: anonymous revision RPC access exists';
  end if;

  if not has_function_privilege('authenticated', 'public.novelight_list_episode_revisions(bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_get_episode_revision(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_restore_episode_revision(bigint,uuid)', 'EXECUTE') then
    raise exception 'postcheck failed: authenticated revision RPC access is missing';
  end if;
end
$$;
