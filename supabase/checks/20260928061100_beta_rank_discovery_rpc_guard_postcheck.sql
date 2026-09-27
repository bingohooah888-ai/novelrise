-- Postcheck for beta work-Rank RPC guard.
do $$
declare
  v_visibility_definition text;
begin
  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.novelight_scout_discoveries_rank_internal_20260928(integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.novelight_scout_recent_activity_rank_internal_20260928(integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.novelight_scout_record_summary_rank_internal_20260928()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.novelight_scout_point_history_rank_internal_20260928(integer)',
       'EXECUTE'
     ) then
    raise exception 'A private Rank backup RPC remains executable by authenticated';
  end if;

  if to_regprocedure('public.novelight_set_scout_badge_visibility_rank_internal_20260928(text,boolean)') is null then
    raise exception 'Original title visibility RPC was not preserved';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.novelight_set_scout_badge_visibility_rank_internal_20260928(text,boolean)',
       'EXECUTE'
     ) then
    raise exception 'Internal title visibility RPC remains browser-callable';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.novelight_set_scout_badge_visibility(text,boolean)',
       'EXECUTE'
     ) then
    raise exception 'Guarded title visibility RPC is not callable by authenticated';
  end if;

  select pg_catalog.pg_get_functiondef(
           'public.novelight_set_scout_badge_visibility(text,boolean)'::regprocedure
         ) into v_visibility_definition;
  if v_visibility_definition not ilike '%d.enabled%' then
    raise exception 'Title visibility RPC does not enforce enabled definitions';
  end if;
end
$$;
