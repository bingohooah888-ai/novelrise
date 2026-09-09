-- NOVELIGHT LIGHT SEED v1 client RPC cutover.
-- Keep the legacy functions for exact rollback/history compatibility, but remove
-- all public client execution paths now that the reader UI uses beta-v2.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260909080000'));

do $$
begin
  if to_regprocedure('public.light_seed_status(text)') is null
     or to_regprocedure('public.plant_light_seed(text)') is null then
    raise exception 'LIGHT SEED v1 RPCs must exist before client cutover';
  end if;

  if to_regprocedure('public.light_seed_status_v2(text)') is null
     or to_regprocedure('public.plant_light_seed_v2(text,text)') is null then
    raise exception 'LIGHT SEED v2 RPCs must exist before v1 client cutover';
  end if;
end
$$;

revoke all on function public.light_seed_status(text) from public, anon, authenticated;
revoke all on function public.plant_light_seed(text) from public, anon, authenticated;

commit;
