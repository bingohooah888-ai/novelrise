\set ON_ERROR_STOP on

begin;

revoke all on function public.novelight_light_seed_feed(integer, integer) from public, anon, authenticated;
drop function if exists public.novelight_light_seed_feed(integer, integer);

commit;
