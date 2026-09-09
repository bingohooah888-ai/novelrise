-- NOVELIGHT LIGHT SEED v1 client RPC cutover precheck.
\set ON_ERROR_STOP on

do $$
begin
  if to_regprocedure('public.light_seed_status(text)') is null
     or to_regprocedure('public.plant_light_seed(text)') is null
     or to_regprocedure('public.light_seed_status_v2(text)') is null
     or to_regprocedure('public.plant_light_seed_v2(text,text)') is null then
    raise exception 'LIGHT SEED v1/v2 RPC contract is incomplete before cutover';
  end if;

  if not has_function_privilege('anon', 'public.light_seed_status(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.light_seed_status(text)', 'EXECUTE') then
    raise exception 'Expected staged v1 status RPC client grants are missing before cutover';
  end if;

  if not has_function_privilege('authenticated', 'public.plant_light_seed(text)', 'EXECUTE') then
    raise exception 'Expected staged v1 send RPC authenticated grant is missing before cutover';
  end if;

  if not has_function_privilege('anon', 'public.light_seed_status_v2(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.light_seed_status_v2(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.plant_light_seed_v2(text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.plant_light_seed_v2(text,text)', 'EXECUTE') then
    raise exception 'LIGHT SEED v2 client grants are not ready for exclusive cutover';
  end if;
end
$$;

select 'PASS: LIGHT SEED v1 client RPC cutover precheck' as result;
