\set ON_ERROR_STOP on

do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.novelight_ranking_feed_v2(text,integer)') is null
     or to_regprocedure(
       'public.novelight_rank_absolute_ceiling_v2(bigint,bigint,bigint,numeric)'
     ) is null
     or to_regprocedure(
       'public.novelight_rank_internal_score_v2(double precision,double precision,double precision,double precision)'
     ) is null then
    raise exception 'Valid-read ranking functions are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'novel_rank_state'
      and column_name = 'last_valid_read_count'
  ) then
    raise exception 'Rank state valid-read evidence column is missing';
  end if;

  select pg_get_functiondef(
    'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'valid_read_count') = 0
     or pg_catalog.strpos(v_definition, 'valid_read_percentile') = 0
     or pg_catalog.strpos(v_definition, 'novelight_rank_absolute_ceiling_v2(') = 0
     or pg_catalog.strpos(v_definition, 'novelight_rank_internal_score_v2(') = 0 then
    raise exception 'Rank evaluator is not using valid-read evidence';
  end if;

  if has_function_privilege(
       'anon', 'public.novelight_ranking_feed(text,integer)', 'EXECUTE'
     )
     or has_function_privilege(
       'authenticated', 'public.novelight_ranking_feed(text,integer)', 'EXECUTE'
     ) then
    raise exception 'Legacy raw-PV ranking feed is still client executable';
  end if;

  if not has_function_privilege(
       'anon', 'public.novelight_ranking_feed_v2(text,integer)', 'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated', 'public.novelight_ranking_feed_v2(text,integer)', 'EXECUTE'
     ) then
    raise exception 'Valid-read ranking feed is not client executable';
  end if;
end
$$;
