\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909120000'));

do $$
begin
  if to_regclass('public.novel_rank_state') is null then
    raise exception 'novel_rank_state is missing';
  end if;

  if exists (
    select 1
      from public.novel_rank_state
     where is_completed
        or completed_at is not null
        or final_rank is not null
        or finalized_at is not null
        or completion_ever_recorded
        or completion_cycle <> 0
        or completion_state_changes_used <> 0
        or dormant_since is not null
        or inactivity_demotions_applied <> 0
        or last_inactivity_demotion_at is not null
  ) then
    raise exception 'Rollback refused: Chapter 38 completion/inactivity lifecycle evidence exists';
  end if;

  if to_regclass('public.novel_final_rank_history') is not null
     and exists (select 1 from public.novel_final_rank_history) then
    raise exception 'Rollback refused: FINAL RANK history exists';
  end if;

  if exists (
    select 1
      from public.scout_event_ledger
     where event_type in (
       'work_completion_changed',
       'work_final_rank_fixed',
       'past_final_rank_visibility_changed'
     )
  ) then
    raise exception 'Rollback refused: replayable lifecycle SCOUT events exist';
  end if;

  if exists (
    select 1
      from public.novel_rank_events
     where event_type = 'finalized'
  ) then
    raise exception 'Rollback refused: FINAL RANK events exist';
  end if;
end
$$;

drop function if exists public.novelight_set_past_final_rank_public(text, smallint, boolean);
drop function if exists public.novelight_set_work_completion_status(text, boolean);
drop function if exists public.novelight_work_completion_status(text);

drop table if exists public.novel_final_rank_history;

alter table public.novel_rank_state
  drop constraint if exists novel_rank_final_requires_completion,
  drop constraint if exists novel_rank_completion_timestamp_consistency,
  drop constraint if exists novel_rank_completion_cycle_consistency,
  drop column if exists last_inactivity_demotion_at,
  drop column if exists inactivity_demotions_applied,
  drop column if exists dormant_since,
  drop column if exists completion_state_changes_used,
  drop column if exists completion_cycle,
  drop column if exists completion_ever_recorded;

do $restore$
declare
  v_definition text;
begin
  select original_rank_recalculator
    into v_definition
    from novelrise_migration_backup.chapter38_rank_lifecycle_state
   where migration_id = '20260909120000'
   for update;

  if v_definition is null then
    raise exception 'Rollback refused: original Rank evaluator backup is missing';
  end if;

  execute v_definition;

  delete from novelrise_migration_backup.chapter38_rank_lifecycle_state
   where migration_id = '20260909120000';
end
$restore$;

revoke all on function public.novelight_recalculate_work_ranks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.novelight_recalculate_work_ranks(timestamptz)
  to service_role;

commit;

select 'PASS: Chapter 38 work Rank lifecycle rollback' as result;
