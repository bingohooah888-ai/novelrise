-- Behavior contract for the LIGHT SEED v1 client RPC cutover.
\set ON_ERROR_STOP on

do $$
begin
  if has_function_privilege('anon', 'public.light_seed_status(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.light_seed_status(text)', 'EXECUTE') then
    raise exception 'Legacy LIGHT SEED status RPC remains client-executable';
  end if;

  if has_function_privilege('anon', 'public.plant_light_seed(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.plant_light_seed(text)', 'EXECUTE') then
    raise exception 'Legacy LIGHT SEED send RPC remains client-executable';
  end if;

  if not has_function_privilege('anon', 'public.light_seed_status_v2(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.light_seed_status_v2(text)', 'EXECUTE') then
    raise exception 'Typed LIGHT SEED v2 status RPC must remain client-readable';
  end if;

  if has_function_privilege('anon', 'public.plant_light_seed_v2(text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.plant_light_seed_v2(text,text)', 'EXECUTE') then
    raise exception 'Typed LIGHT SEED v2 send RPC authentication boundary changed';
  end if;
end
$$;

select 'PASS: LIGHT SEED clients are v2-only' as result;
