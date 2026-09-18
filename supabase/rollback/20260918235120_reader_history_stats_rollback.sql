\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260918235120:rollback'));

revoke all on function public.novelight_reader_history_stats(integer)
  from public, anon, authenticated, service_role;
drop function if exists public.novelight_reader_history_stats(integer);

commit;
