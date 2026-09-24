\set ON_ERROR_STOP on

do $$
declare
  v_inventory_definition text;
  v_received_definition text;
begin
  if to_regprocedure('public.novelight_light_seed_inventory()') is null
     or to_regprocedure('public.novelight_author_received_light_seed_summary(text)') is null then
    raise exception 'LIGHT SEED inventory/received summary RPCs are incomplete';
  end if;

  if has_function_privilege('anon', 'public.novelight_light_seed_inventory()', 'execute')
     or not has_function_privilege('authenticated', 'public.novelight_light_seed_inventory()', 'execute') then
    raise exception 'LIGHT SEED inventory RPC grants are incorrect';
  end if;

  if has_function_privilege('anon', 'public.novelight_author_received_light_seed_summary(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.novelight_author_received_light_seed_summary(text)', 'execute') then
    raise exception 'Received LIGHT SEED summary RPC grants are incorrect';
  end if;

  if has_table_privilege('authenticated', 'public.light_seed_monthly_inventory', 'select') then
    raise exception 'LIGHT SEED monthly inventory must remain RPC-only and private';
  end if;

  select pg_get_functiondef(
    'public.novelight_light_seed_inventory()'::regprocedure
  ) into v_inventory_definition;

  if pg_catalog.strpos(v_inventory_definition, 'gold_remaining') = 0
     or pg_catalog.strpos(v_inventory_definition, 'silver_remaining') = 0
     or pg_catalog.strpos(v_inventory_definition, 'bronze_remaining') = 0
     or pg_catalog.strpos(v_inventory_definition, 'remaining_this_month') = 0 then
    raise exception 'LIGHT SEED inventory payload is incomplete';
  end if;

  select pg_get_functiondef(
    'public.novelight_author_received_light_seed_summary(text)'::regprocedure
  ) into v_received_definition;

  if pg_catalog.strpos(v_received_definition, 'Only the work owner') = 0
     or pg_catalog.strpos(v_received_definition, 'gold_count') = 0
     or pg_catalog.strpos(v_received_definition, 'silver_count') = 0
     or pg_catalog.strpos(v_received_definition, 'bronze_count') = 0
     or pg_catalog.strpos(v_received_definition, 'legacy_count') = 0 then
    raise exception 'Received LIGHT SEED owner boundary or typed breakdown drifted';
  end if;
end
$$;
