\set ON_ERROR_STOP on

-- Inquiry #84: confirm the patched RPCs preserve their entitlement/security gates.
do $$
declare
  v_name text;
  v_proc oid;
  v_definition text;
begin
  foreach v_name in array array[
    'public.novelight_author_exposure_funnel_v2(integer)',
    'public.novelight_author_analytics_timeseries(integer)'
  ] loop
    v_proc := to_regprocedure(v_name);
    if v_proc is null then
      raise exception 'Missing analytics RPC %', v_name;
    end if;

    select lower(pg_get_functiondef(v_proc)) into v_definition;
    if position('reader_cohorts as materialized' in v_definition) = 0
       or position('c.viewer_key_snapshot' in v_definition) = 0
       or position('rc.last_second_at > rc.first_at' in v_definition) = 0
       or position('c.author_id_snapshot = v_uid' in v_definition) = 0
       or position('p_days > 90' in v_definition) = 0 then
      raise exception 'Analytics cross-visit cohort definition incomplete: %', v_name;
    end if;

    if has_function_privilege('anon', v_proc, 'EXECUTE') then
      raise exception 'Anonymous analytics access forbidden: %', v_name;
    end if;
    if not has_function_privilege('authenticated', v_proc, 'EXECUTE') then
      raise exception 'Authenticated analytics access required: %', v_name;
    end if;
  end loop;

  if position('having v_plan = ''free''' in lower(
    pg_get_functiondef('public.novelight_author_exposure_funnel_v2(integer)'::regprocedure)
  )) = 0 then
    raise exception 'Free aggregate-only plan boundary lost';
  end if;
  if position('where v_plan in (''standard'', ''premium'')' in lower(
    pg_get_functiondef('public.novelight_author_exposure_funnel_v2(integer)'::regprocedure)
  )) = 0 then
    raise exception 'Standard/Premium per-work plan boundary lost';
  end if;
end $$;
