-- Roll back NOVELIGHT LIGHT SEED MVP objects.
-- This intentionally removes LIGHT SEED ledger data; use only for an immediate
-- rollback before real beta discovery history must be preserved.

\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823083500'));

revoke all on function public.plant_light_seed(text) from public, anon, authenticated;
revoke all on function public.light_seed_status(text) from public, anon, authenticated;

drop function if exists public.plant_light_seed(text);
drop function if exists public.light_seed_status(text);

drop table if exists public.light_seeds;
drop table if exists public.light_seed_rules;

commit;
