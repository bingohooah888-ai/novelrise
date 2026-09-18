-- Read-only postcheck for 20260918112000_typo_report_review.sql

do $$
declare
  v_name text;
begin
  if to_regclass('public.novel_typo_report_settings') is null
     or to_regclass('public.episode_typo_reports') is null then
    raise exception 'POSTCHECK FAIL: typo report tables are missing';
  end if;

  if not coalesce((select relrowsecurity from pg_class where oid='public.novel_typo_report_settings'::regclass), false)
     or not coalesce((select relrowsecurity from pg_class where oid='public.episode_typo_reports'::regclass), false) then
    raise exception 'POSTCHECK FAIL: typo report RLS is not enabled';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and table_name='episode_typo_reports'
       and column_name='context_before'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and table_name='episode_typo_reports'
       and column_name='context_after'
  ) then
    raise exception 'POSTCHECK FAIL: local context anchors are missing';
  end if;

  if has_table_privilege('anon','public.novel_typo_report_settings','SELECT')
     or has_table_privilege('anon','public.novel_typo_report_settings','INSERT')
     or has_table_privilege('anon','public.novel_typo_report_settings','UPDATE')
     or has_table_privilege('anon','public.novel_typo_report_settings','DELETE')
     or has_table_privilege('authenticated','public.novel_typo_report_settings','SELECT')
     or has_table_privilege('authenticated','public.novel_typo_report_settings','INSERT')
     or has_table_privilege('authenticated','public.novel_typo_report_settings','UPDATE')
     or has_table_privilege('authenticated','public.novel_typo_report_settings','DELETE')
     or has_table_privilege('anon','public.episode_typo_reports','SELECT')
     or has_table_privilege('anon','public.episode_typo_reports','INSERT')
     or has_table_privilege('anon','public.episode_typo_reports','UPDATE')
     or has_table_privilege('anon','public.episode_typo_reports','DELETE')
     or has_table_privilege('authenticated','public.episode_typo_reports','SELECT')
     or has_table_privilege('authenticated','public.episode_typo_reports','INSERT')
     or has_table_privilege('authenticated','public.episode_typo_reports','UPDATE')
     or has_table_privilege('authenticated','public.episode_typo_reports','DELETE') then
    raise exception 'POSTCHECK FAIL: raw typo report tables are client-accessible';
  end if;

  if not has_function_privilege('anon','public.novelight_typo_report_state(bigint)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_typo_report_state(bigint)','EXECUTE')
     or not has_function_privilege('service_role','public.novelight_typo_report_state(bigint)','EXECUTE') then
    raise exception 'POSTCHECK FAIL: typo report state grants are incomplete';
  end if;

  if has_function_privilege('anon','public.novelight_submit_typo_report(bigint,text,text)','EXECUTE')
     or has_function_privilege('anon','public.novelight_author_typo_report_settings(bigint)','EXECUTE')
     or has_function_privilege('anon','public.novelight_author_typo_reports(bigint,text)','EXECUTE')
     or has_function_privilege('anon','public.novelight_apply_typo_report(uuid)','EXECUTE')
     or has_function_privilege('anon','public.novelight_reject_typo_report(uuid)','EXECUTE') then
    raise exception 'POSTCHECK FAIL: anonymous typo mutation/review access exists';
  end if;

  if not has_function_privilege('authenticated','public.novelight_submit_typo_report(bigint,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_author_typo_report_settings(bigint)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_set_novel_typo_reports_enabled(bigint,boolean)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_author_typo_reports(bigint,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_apply_typo_report(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.novelight_reject_typo_report(uuid)','EXECUTE') then
    raise exception 'POSTCHECK FAIL: authenticated typo workflow grants are incomplete';
  end if;

  foreach v_name in array array[
    'novelight_typo_report_state',
    'novelight_author_typo_report_settings',
    'novelight_set_novel_typo_reports_enabled',
    'novelight_submit_typo_report',
    'novelight_author_typo_reports',
    'novelight_apply_typo_report',
    'novelight_reject_typo_report'
  ]
  loop
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
         and p.proname=v_name
         and p.prosecdef
         and coalesce(array_to_string(p.proconfig, ','),'') like '%search_path=""%'
    ) then
      raise exception 'POSTCHECK FAIL: function % lacks hardened SECURITY DEFINER config', v_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes
     where schemaname='public'
       and indexname='episode_typo_reports_pending_duplicate_idx'
  ) then
    raise exception 'POSTCHECK FAIL: pending duplicate suppression index is missing';
  end if;

  if pg_get_functiondef('public.novelight_apply_typo_report(uuid)'::regprocedure)
     not like '%novelight.revision_reason%'
     or pg_get_functiondef('public.novelight_apply_typo_report(uuid)'::regprocedure)
     not like '%typo_apply%'
     or pg_get_functiondef('public.novelight_apply_typo_report(uuid)'::regprocedure)
     not like '%context_before%'
     or pg_get_functiondef('public.novelight_apply_typo_report(uuid)'::regprocedure)
     not like '%context_after%'
     or pg_get_functiondef('public.novelight_apply_typo_report(uuid)'::regprocedure)
     not like '%TYPO_REPORT_RESULT_EMPTY%'
     or pg_get_functiondef('public.novelight_apply_typo_report(uuid)'::regprocedure)
     not like '%TYPO_REPORT_RESULT_TOO_LONG%' then
    raise exception 'POSTCHECK FAIL: typo apply safety or revision binding is incomplete';
  end if;
end
$$;

select 'POSTCHECK PASS: typo report workflow is private, bounded, and review-gated' as result;
