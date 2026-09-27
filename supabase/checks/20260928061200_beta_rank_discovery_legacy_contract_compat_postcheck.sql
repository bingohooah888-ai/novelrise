-- Postcheck for beta discovery legacy-contract compatibility shim.
do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
           'public.novelight_award_discovery_points()'::regprocedure
         ) into v_definition;

  if pg_catalog.strpos(v_definition, 'when v_delta >= 5 then 200') = 0
     or pg_catalog.strpos(v_definition, '''nova_prediction'', 25') = 0 then
    raise exception 'Historical Chapter 49 discovery rule markers are missing';
  end if;

  if pg_catalog.strpos(v_definition, 'if false then') = 0 then
    raise exception 'Historical discovery markers must remain unreachable';
  end if;
end
$$;
