\set ON_ERROR_STOP on

do $$
declare
  v_function_count integer;
begin
  if to_regclass('public.author_interaction_defaults') is null
     or to_regclass('public.novel_interaction_settings') is null
     or to_regclass('public.episode_typo_reports') is null then
    raise exception 'One or more typo-report tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.author_interaction_defaults'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.novel_interaction_settings'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.episode_typo_reports'::regclass) then
    raise exception 'RLS must be enabled on every typo-report table';
  end if;

  if has_table_privilege('anon', 'public.author_interaction_defaults', 'SELECT')
     or has_table_privilege('authenticated', 'public.author_interaction_defaults', 'SELECT')
     or has_table_privilege('anon', 'public.novel_interaction_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_interaction_settings', 'SELECT')
     or has_table_privilege('anon', 'public.episode_typo_reports', 'SELECT')
     or has_table_privilege('authenticated', 'public.episode_typo_reports', 'SELECT') then
    raise exception 'Raw typo-report tables must not be client-readable';
  end if;

  if has_table_privilege('authenticated', 'public.episode_typo_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.episode_typo_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.episode_typo_reports', 'DELETE') then
    raise exception 'Typo report writes must stay behind bounded RPCs';
  end if;

  if to_regprocedure('public.novelight_author_typo_report_defaults()') is null
     or to_regprocedure('public.novelight_set_author_typo_report_defaults(boolean)') is null
     or to_regprocedure('public.novelight_author_novel_typo_report_settings(bigint)') is null
     or to_regprocedure('public.novelight_set_novel_typo_report_settings(bigint,boolean)') is null
     or to_regprocedure('public.novelight_typo_report_state(bigint)') is null
     or to_regprocedure('public.novelight_submit_typo_report(bigint,integer,text,text)') is null
     or to_regprocedure('public.novelight_list_author_typo_reports(bigint)') is null
     or to_regprocedure('public.novelight_resolve_typo_report(uuid,text)') is null then
    raise exception 'One or more typo-report RPCs are missing';
  end if;

  if has_function_privilege('anon', 'public.novelight_submit_typo_report(bigint,integer,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_list_author_typo_reports(bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_resolve_typo_report(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_set_author_typo_report_defaults(boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_set_novel_typo_report_settings(bigint,boolean)', 'EXECUTE') then
    raise exception 'Anonymous users must not execute typo mutation/author RPCs';
  end if;

  if not has_function_privilege('authenticated', 'public.novelight_submit_typo_report(bigint,integer,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_list_author_typo_reports(bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_resolve_typo_report(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_set_author_typo_report_defaults(boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_set_novel_typo_report_settings(bigint,boolean)', 'EXECUTE') then
    raise exception 'Authenticated typo-report grants are incomplete';
  end if;

  if not has_function_privilege('anon', 'public.novelight_typo_report_state(bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_typo_report_state(bigint)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_typo_report_state(bigint)', 'EXECUTE') then
    raise exception 'Typo-report state RPC grants are incomplete';
  end if;

  select count(*)::integer
    into v_function_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'novelight_author_typo_report_defaults',
       'novelight_set_author_typo_report_defaults',
       'novelight_author_novel_typo_report_settings',
       'novelight_set_novel_typo_report_settings',
       'novelight_typo_report_state',
       'novelight_submit_typo_report',
       'novelight_list_author_typo_reports',
       'novelight_resolve_typo_report'
     )
     and p.prosecdef
     and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%';

  if v_function_count <> 8 then
    raise exception 'Typo-report RPC SECURITY DEFINER/search_path contract is incomplete';
  end if;

  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and indexname = 'episode_typo_reports_pending_duplicate_idx'
       and indexdef ilike '%where (status = ''pending''%'
  ) then
    raise exception 'Pending typo-report duplicate suppression index is missing';
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.episodes'::regclass
       and tgname = 'episode_revision_history_before_update'
       and not tgisinternal
  ) then
    raise exception 'Episode revision trigger was lost';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.episode_revisions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%typo_apply%'
  ) then
    raise exception 'Revision history no longer supports typo_apply';
  end if;
end
$$;

select 'POSTCHECK PASS: typo-report workflow is private, bounded, and revision-safe' as result;
