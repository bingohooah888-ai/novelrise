\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260920223049:rollback'));

-- Stop all Chapter 49 beta-core mutations first. Data already earned is kept as
-- audit history; rollback never deletes Scout XP, Scout Point, or source events.
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

-- Keep novelight_scout_level_for_xp(), scout_level_thresholds, and
-- scout_point_ledger as private audit dependencies if any data exists.
-- They expose no browser grants and preserving them makes rollback non-lossy.
revoke all on table public.scout_point_ledger from public, anon, authenticated;
revoke all on table public.scout_level_thresholds from public, anon, authenticated;
revoke all on function public.novelight_scout_level_for_xp(bigint)
  from public, anon, authenticated;

commit;
