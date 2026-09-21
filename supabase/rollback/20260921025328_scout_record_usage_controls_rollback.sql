\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260921025328:rollback'));

drop trigger if exists scout_point_earning_control on public.scout_point_ledger;

drop function if exists public.novelight_admin_scout_point_action(
  uuid, text, text, uuid, uuid, timestamptz, integer
);
drop function if exists public.novelight_enforce_scout_point_control();
drop function if exists public.novelight_scout_point_earning_allowed(uuid);
drop function if exists public.novelight_record_scout_record_visit();

do $$
declare
  v_has_usage boolean;
  v_has_controls boolean;
  v_has_actions boolean;
begin
  select exists (select 1 from public.scout_record_usage_days)
    into v_has_usage;
  select exists (select 1 from public.scout_point_user_controls)
    into v_has_controls;
  select exists (select 1 from public.scout_point_operator_actions)
    into v_has_actions;

  if not v_has_usage and not v_has_controls and not v_has_actions then
    drop table public.scout_point_operator_actions;
    drop table public.scout_point_user_controls;
    drop table public.scout_record_usage_days;
  else
    revoke all on table public.scout_record_usage_days
      from public, anon, authenticated;
    revoke all on table public.scout_point_user_controls
      from public, anon, authenticated;
    revoke all on table public.scout_point_operator_actions
      from public, anon, authenticated;
  end if;
end
$$;

commit;
