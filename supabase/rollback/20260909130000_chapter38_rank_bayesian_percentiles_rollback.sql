\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909130000'));

do $restore$
declare
  v_definition text;
begin
  if to_regclass('novelrise_migration_backup.chapter38_rank_bayesian_percentile_state') is null then
    raise exception 'Rollback refused: Bayesian percentile Rank backup table is missing';
  end if;

  select original_rank_recalculator
    into v_definition
    from novelrise_migration_backup.chapter38_rank_bayesian_percentile_state
   where migration_id = '20260909130000'
   for update;

  if v_definition is null then
    raise exception 'Rollback refused: original Rank evaluator backup is missing';
  end if;

  if pg_catalog.strpos(
       pg_get_functiondef(
         'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
       ),
       'public.novelight_rank_internal_score('
     ) = 0 then
    raise exception 'Rollback refused: current Rank evaluator is not the Bayesian percentile implementation';
  end if;

  execute v_definition;

  delete from novelrise_migration_backup.chapter38_rank_bayesian_percentile_state
   where migration_id = '20260909130000';
end
$restore$;

drop function public.novelight_rank_internal_score(
  double precision,
  double precision,
  double precision,
  double precision
);
drop function public.novelight_bayesian_rating_average(bigint, numeric, numeric);
drop function public.novelight_global_rating_baseline();

drop table novelrise_migration_backup.chapter38_rank_bayesian_percentile_state;

revoke all on function public.novelight_recalculate_work_ranks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.novelight_recalculate_work_ranks(timestamptz)
  to service_role;

commit;

select 'PASS: Chapter 38 Bayesian percentile Rank score rollback' as result;
