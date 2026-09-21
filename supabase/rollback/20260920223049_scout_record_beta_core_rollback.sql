\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920223049:rollback'));

-- Stop all Chapter 49 beta-core mutations first. Earned data is never deleted.
drop trigger if exists scout_event_discovery_points on public.scout_event_ledger;
drop trigger if exists scout_xp_level_up_points on public.scout_xp_ledger;
drop trigger if exists scout_event_valid_read_xp on public.scout_event_ledger;
drop trigger if exists scout_xp_beta_level_cap on public.scout_xp_ledger;

drop function if exists public.novelight_scout_discoveries(integer);
drop function if exists public.novelight_scout_recent_activity(integer);
drop function if exists public.novelight_scout_point_history(integer);
drop function if exists public.novelight_scout_record_summary();

drop function if exists public.novelight_award_discovery_points();
drop function if exists public.novelight_award_level_up_points();
drop function if exists public.novelight_award_valid_read_scout_xp();
drop function if exists public.novelight_cap_scout_xp_beta();

do $$
declare
  v_has_point_data boolean;
  v_has_chapter49_xp boolean;
begin
  select exists (
    select 1 from public.scout_point_ledger
  ) into v_has_point_data;

  select exists (
    select 1
    from public.scout_xp_ledger
    where rule_version = 'chapter49-beta-v1'
  ) into v_has_chapter49_xp;

  if not v_has_point_data and not v_has_chapter49_xp then
    execute 'drop table public.scout_point_ledger';
    execute 'drop table public.scout_level_thresholds';
    execute 'drop function public.novelight_scout_level_for_xp(bigint)';
  else
    -- Production-safe rollback: preserve all earned/audit data behind private
    -- tables and remove only the active mutation/UI path.
    revoke all on table public.scout_point_ledger from public, anon, authenticated;
    revoke all on table public.scout_level_thresholds from public, anon, authenticated;
    revoke all on function public.novelight_scout_level_for_xp(bigint)
      from public, anon, authenticated;
  end if;
end
$$;

commit;
