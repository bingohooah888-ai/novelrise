\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.episode_typo_reports') is null then
    raise exception 'public.episode_typo_reports was not created';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.episode_typo_reports'::regclass) then
    raise exception 'RLS is not enabled on public.episode_typo_reports';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and table_name='novels'
       and column_name='typo_reports_enabled'
       and data_type='boolean'
       and is_nullable='NO'
  ) then
    raise exception 'novels.typo_reports_enabled is missing or nullable';
  end if;

  if has_table_privilege('anon','public.episode_typo_reports','SELECT')
     or has_table_privilege('anon','public.episode_typo_reports','INSERT')
     or has_table_privilege('authenticated','public.episode_typo_reports','SELECT')
     or has_table_privilege('authenticated','public.episode_typo_reports','INSERT')
     or has_table_privilege('authenticated','public.episode_typo_reports','UPDATE')
     or has_table_privilege('authenticated','public.episode_typo_reports','DELETE') then
    raise exception 'Typo-report rows must not be directly accessible to clients';
  end if;

  if to_regprocedure('public.novelight_submit_episode_typo_report(bigint,integer,text,text)') is null
     or to_regprocedure('public.novelight_list_episode_typo_reports(bigint)') is null
     or to_regprocedure('public.novelight_apply_episode_typo_report(uuid)') is null
     or to_regprocedure('public.novelight_reject_episode_typo_report(uuid)') is null
     or to_regprocedure('public.novelight_stale_episode_typo_reports()') is null then
    raise exception 'One or more typo-report functions are missing';
  end if;

  if has_function_privilege('anon','public.novelight_submit_episode_typo_report(bigint,integer,text,text)','EXECUTE')
     or has_function_privilege('anon','public.novelight_list_episode_typo_reports(bigint)','EXECUTE')
     or has_function_privilege('anon','public.novelight_apply_episode_typo_report(uuid)','EXECUTE')
     or has_function_privilege('anon','public.novelight_reject_episode_typo_report(uuid)','EXECUTE')
     or has_function_privilege('anon','public.novelight_stale_episode_typo_reports()','EXECUTE') then
    raise exception 'Anonymous typo-report RPC access exists';
  end if;

  if not has_function_privilege('authenticated','public.novelight_submit_episode_typo_report(bigint,integer,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_list_episode_typo_reports(bigint)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_apply_episode_typo_report(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_reject_episode_typo_report(uuid)','EXECUTE') then
    raise exception 'Authenticated typo-report RPC grants are incomplete';
  end if;

  if not has_function_privilege('service_role','public.novelight_submit_episode_typo_report(bigint,integer,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.novelight_list_episode_typo_reports(bigint)','EXECUTE')
     or not has_function_privilege('service_role','public.novelight_apply_episode_typo_report(uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.novelight_reject_episode_typo_report(uuid)','EXECUTE') then
    raise exception 'service_role typo-report RPC grants are incomplete';
  end if;

  if has_function_privilege('authenticated','public.novelight_stale_episode_typo_reports()','EXECUTE')
     or has_function_privilege('service_role','public.novelight_stale_episode_typo_reports()','EXECUTE') then
    raise exception 'Internal stale trigger function must not be client/server RPC surface';
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgrelid='public.episodes'::regclass
       and tgname='episode_typo_reports_after_content_update'
       and not tgisinternal
  ) then
    raise exception 'Typo-report stale trigger is missing';
  end if;

  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in (
         'novelight_submit_episode_typo_report',
         'novelight_list_episode_typo_reports',
         'novelight_apply_episode_typo_report',
         'novelight_reject_episode_typo_report',
         'novelight_stale_episode_typo_reports'
       )
       and (
         not p.prosecdef
         or coalesce(array_to_string(p.proconfig,','),'') not like '%search_path=""%'
       )
  ) then
    raise exception 'Typo-report functions are not hardened SECURITY DEFINER functions';
  end if;

  if position(
    '''typo_apply''' in pg_get_functiondef(
      'public.novelight_capture_episode_revision()'::regprocedure
    )
  ) = 0 then
    raise exception 'Revision history no longer recognizes typo_apply';
  end if;
end
$$;
