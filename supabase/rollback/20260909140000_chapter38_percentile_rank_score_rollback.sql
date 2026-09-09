\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909140000'));

do $guard$
declare
  v_applied_at timestamptz;
begin
  select applied_at
    into v_applied_at
    from novelrise_migration_backup.chapter38_percentile_rank_score_state
   where migration_id = '20260909140000'
   for update;

  if v_applied_at is null then
    raise exception 'Rollback refused: percentile Rank score backup is missing';
  end if;

  if exists (
    select 1
      from public.novel_rank_state s
     where s.updated_at > v_applied_at
  ) then
    raise exception 'Rollback refused: Rank/lifecycle state changed after percentile score migration';
  end if;
end
$guard$;

do $restore$
declare
  v_definition text;
begin
  select original_rank_recalculator
    into v_definition
    from novelrise_migration_backup.chapter38_percentile_rank_score_state
   where migration_id = '20260909140000'
   for update;

  if v_definition is null then
    raise exception 'Rollback refused: original Rank evaluator definition is missing';
  end if;

  execute v_definition;

  delete from novelrise_migration_backup.chapter38_percentile_rank_score_state
   where migration_id = '20260909140000';
end
$restore$;

drop function if exists public.novelight_bayesian_adjusted_rating(bigint, numeric, numeric);

revoke all on function public.novelight_recalculate_work_ranks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.novelight_recalculate_work_ranks(timestamptz)
  to service_role;

commit;

select 'PASS: Chapter 38 percentile Rank score rollback' as result;
