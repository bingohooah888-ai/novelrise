\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918180500:rollback'));

revoke all on function public.novelight_batch_manage_episode_schedules(bigint, jsonb)
  from public, anon, authenticated, service_role;

drop function if exists public.novelight_batch_manage_episode_schedules(bigint, jsonb);

-- B #13 adds no table, column, cron job, or stored schedule data of its own.
-- Existing single-episode schedules and the 20260916100000 scheduler foundation
-- intentionally remain untouched.

commit;
