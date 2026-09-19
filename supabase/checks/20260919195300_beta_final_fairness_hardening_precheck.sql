\set ON_ERROR_STOP on

do $$
declare
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.record_valid_read_progress(text,uuid,double precision,integer,integer)',
    'public.novelight_recalculate_work_ranks(timestamp with time zone)',
    'public.novelight_ranking_feed_v2(text,integer)',
    'public.novelight_favorite_count(text)',
    'public.novelight_neutral_search(text,text,text,integer,integer)',
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)',
    'public.light_seed_status_v2(text)',
    'public.plant_light_seed_v2(text,text)'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Required fairness function is missing: %', v_signature;
    end if;
  end loop;

  if to_regclass('public.favorites') is null
     or to_regclass('public.valid_read_events') is null then
    raise exception 'Fairness source tables are missing';
  end if;
  select pg_get_functiondef(
    'public.record_valid_read_progress(text,uuid,double precision,integer,integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'if v_signal_count >= 2 then') = 0 then
    raise exception 'Valid-read precondition no longer matches the audited state';
  end if;

  select pg_get_functiondef(
    'public.novelight_neutral_search(text,text,text,integer,integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'case when p_sort = ''pv'' then c.pv end desc nulls last'
     ) = 0 then
    raise exception 'Neutral-search raw-PV precondition no longer matches';
  end if;

  select pg_get_functiondef(
    'public.novelight_discovery_feed_v2(text,integer,text,text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'and e.exposed_at >= now() - interval ''7 days'''
     ) = 0 then
    raise exception 'Discovery preopen-balance precondition no longer matches';
  end if;
end
$$;
