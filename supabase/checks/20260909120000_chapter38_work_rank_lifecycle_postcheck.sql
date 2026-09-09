\set ON_ERROR_STOP on

do $$
declare
  v_column_count integer;
  v_rls boolean;
begin
  select count(*)::integer
    into v_column_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'novel_rank_state'
     and column_name in (
       'completion_ever_recorded',
       'completion_cycle',
       'completion_state_changes_used',
       'dormant_since',
       'inactivity_demotions_applied',
       'last_inactivity_demotion_at'
     );

  if v_column_count <> 6 then
    raise exception 'Rank lifecycle state columns are incomplete';
  end if;

  if to_regclass('public.novel_final_rank_history') is null then
    raise exception 'FINAL RANK history table is missing';
  end if;

  select c.relrowsecurity
    into v_rls
    from pg_class c
   where c.oid = 'public.novel_final_rank_history'::regclass;

  if not coalesce(v_rls, false) then
    raise exception 'FINAL RANK history RLS must be enabled';
  end if;

  if has_table_privilege('anon', 'public.novel_final_rank_history', 'SELECT')
     or has_table_privilege('authenticated', 'public.novel_final_rank_history', 'SELECT')
     or has_table_privilege('anon', 'public.novel_final_rank_history', 'INSERT')
     or has_table_privilege('authenticated', 'public.novel_final_rank_history', 'UPDATE') then
    raise exception 'Raw FINAL RANK history must remain hidden from clients';
  end if;

  if to_regprocedure('public.novelight_work_completion_status(text)') is null
     or to_regprocedure('public.novelight_set_work_completion_status(text,boolean)') is null
     or to_regprocedure('public.novelight_set_past_final_rank_public(text,smallint,boolean)') is null then
    raise exception 'Completion lifecycle RPCs are missing';
  end if;

  if has_function_privilege('anon', 'public.novelight_work_completion_status(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_work_completion_status(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_set_work_completion_status(text,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_set_work_completion_status(text,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.novelight_set_past_final_rank_public(text,smallint,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.novelight_set_past_final_rank_public(text,smallint,boolean)', 'EXECUTE') then
    raise exception 'Completion lifecycle RPC grants do not match the authenticated-owner contract';
  end if;

  if has_function_privilege('anon', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE') then
    raise exception 'Global Rank evaluator must remain service_role-only';
  end if;

  if not exists (
    select 1
      from novelrise_migration_backup.chapter38_rank_lifecycle_state
     where migration_id = '20260909120000'
       and original_rank_recalculator is not null
       and length(original_rank_recalculator) > 0
  ) then
    raise exception 'Rollback function backup is missing';
  end if;
end
$$;

select 'PASS: Chapter 38 work Rank lifecycle postcheck' as result;
