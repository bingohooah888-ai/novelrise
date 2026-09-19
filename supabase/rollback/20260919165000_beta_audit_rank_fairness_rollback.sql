\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260919165000:rollback'));

do $$
declare
  v_rank_definition text;
  v_feed_definition text;
begin
  select
    original_rank_recalculator,
    original_ranking_feed
  into
    v_rank_definition,
    v_feed_definition
  from novelrise_migration_backup.beta_audit_rank_fairness_state
  where migration_id = '20260919165000';

  if v_rank_definition is null or v_feed_definition is null then
    raise exception 'Rank fairness rollback backup is unavailable';
  end if;

  execute v_rank_definition;
  execute v_feed_definition;
end
$$;

revoke all on function public.novelight_recalculate_work_ranks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.novelight_recalculate_work_ranks(timestamptz)
  to service_role;

grant execute on function public.novelight_ranking_feed(text, integer)
  to anon, authenticated;

revoke all on function public.novelight_ranking_feed_v2(text, integer)
  from public, anon, authenticated;
drop function if exists public.novelight_ranking_feed_v2(text, integer);

drop function if exists public.novelight_rank_internal_score_v2(
  double precision, double precision, double precision, double precision
);
drop function if exists public.novelight_rank_absolute_ceiling_v2(
  bigint, bigint, bigint, numeric
);

alter table public.novel_rank_state
  drop column if exists last_valid_read_count;

commit;
