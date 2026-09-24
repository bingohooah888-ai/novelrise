\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260924214000:rollback'));

drop function if exists public.novelight_author_received_light_seed_summary(text);
drop function if exists public.novelight_light_seed_inventory();

commit;
