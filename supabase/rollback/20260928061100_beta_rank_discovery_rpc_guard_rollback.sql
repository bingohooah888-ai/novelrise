-- Guarded rollback for 20260928061100_beta_rank_discovery_rpc_guard.sql.
-- Apply before rolling back 20260928061000_beta_rank_discovery_privacy.sql.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260928061100:rollback'));

do $$
begin
  if to_regprocedure('public.novelight_set_scout_badge_visibility_rank_internal_20260928(text,boolean)') is null then
    raise exception 'Original title visibility function backup is missing';
  end if;
end
$$;

drop function if exists public.novelight_set_scout_badge_visibility(text, boolean);
alter function public.novelight_set_scout_badge_visibility_rank_internal_20260928(text, boolean)
  rename to novelight_set_scout_badge_visibility;

revoke all on function public.novelight_set_scout_badge_visibility(text, boolean)
  from public, anon;
grant execute on function public.novelight_set_scout_badge_visibility(text, boolean)
  to authenticated;

-- Restore the original browser grants on the compatibility RPCs. The underlying
-- 61000 rollback immediately follows when fully reverting the policy.
revoke all on function public.novelight_scout_record_summary_rank_internal_20260928()
  from public, anon;
grant execute on function public.novelight_scout_record_summary_rank_internal_20260928()
  to authenticated;

revoke all on function public.novelight_scout_point_history_rank_internal_20260928(integer)
  from public, anon;
grant execute on function public.novelight_scout_point_history_rank_internal_20260928(integer)
  to authenticated;

revoke all on function public.novelight_scout_recent_activity_rank_internal_20260928(integer)
  from public, anon;
grant execute on function public.novelight_scout_recent_activity_rank_internal_20260928(integer)
  to authenticated;

revoke all on function public.novelight_scout_discoveries_rank_internal_20260928(integer)
  from public, anon;
grant execute on function public.novelight_scout_discoveries_rank_internal_20260928(integer)
  to authenticated;

commit;
