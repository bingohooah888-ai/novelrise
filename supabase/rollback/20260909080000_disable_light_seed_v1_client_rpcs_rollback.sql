-- NOVELIGHT LIGHT SEED v1 client RPC cutover rollback.
-- Restore the exact staged v1 client grants without changing function bodies or
-- touching beta-v2 evidence/data.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260909080000'));

do $$
begin
  if to_regprocedure('public.light_seed_status(text)') is null
     or to_regprocedure('public.plant_light_seed(text)') is null then
    raise exception 'LIGHT SEED v1 RPCs are missing; refusing partial ACL rollback';
  end if;
end
$$;

revoke all on function public.light_seed_status(text) from public, anon, authenticated;
revoke all on function public.plant_light_seed(text) from public, anon, authenticated;

grant execute on function public.light_seed_status(text) to anon, authenticated;
grant execute on function public.plant_light_seed(text) to authenticated;

commit;

select 'PASS: LIGHT SEED v1 client RPC cutover rollback' as result;
