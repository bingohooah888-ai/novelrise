-- Run only as a separately authorized rollback.
-- Historical guard counters contain no raw visitor addresses.
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('novelight:20261013153500:guest-guard')
);
drop function if exists public.novelight_contest_guest_creation_slot(text);
drop table if exists public.novelight_contest_guest_creation_guard;
commit;
