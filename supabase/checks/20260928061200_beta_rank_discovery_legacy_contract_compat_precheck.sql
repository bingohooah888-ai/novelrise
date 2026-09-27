-- Precheck for beta discovery legacy-contract compatibility shim.
do $$
begin
  if to_regprocedure('public.novelight_award_discovery_points()') is null then
    raise exception 'Beta discovery Point guard is missing';
  end if;
end
$$;
