\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.novel_rank_state') is null
     or to_regclass('public.novel_rank_events') is null
     or to_regclass('public.scout_event_ledger') is null
     or to_regprocedure('public.novelight_recalculate_work_ranks(timestamp with time zone)') is null then
    raise exception 'Chapter 38 Rank engine prerequisites are missing';
  end if;

  if to_regprocedure('public.novelight_set_work_completion_status(text,boolean)') is not null
     or to_regprocedure('public.novelight_work_completion_status(text)') is not null
     or to_regprocedure('public.novelight_set_past_final_rank_public(text,smallint,boolean)') is not null
     or to_regclass('public.novel_final_rank_history') is not null then
    raise exception 'Chapter 38 Rank lifecycle objects already exist';
  end if;

  if exists (
    select 1
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
       )
  ) then
    raise exception 'Chapter 38 Rank lifecycle state columns already exist';
  end if;

  if exists (
    select 1
      from public.novel_rank_state
     where is_completed
        or completed_at is not null
        or final_rank is not null
        or finalized_at is not null
  ) then
    raise exception 'Pre-existing completion or FINAL RANK state requires manual review';
  end if;

  if has_function_privilege('anon', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.novelight_recalculate_work_ranks(timestamp with time zone)', 'EXECUTE') then
    raise exception 'Global Rank evaluator privileges do not match the required service_role-only contract';
  end if;
end
$$;

select 'PASS: Chapter 38 work Rank lifecycle precheck' as result;
