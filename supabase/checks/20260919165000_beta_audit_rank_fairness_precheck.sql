\set ON_ERROR_STOP on

do $$
begin
  if to_regprocedure(
    'public.novelight_recalculate_work_ranks(timestamp with time zone)'
  ) is null then
    raise exception 'Rank evaluator is missing';
  end if;

  if to_regprocedure('public.novelight_ranking_feed(text,integer)') is null then
    raise exception 'Legacy ranking feed is missing';
  end if;

  if to_regclass('public.valid_read_events') is null then
    raise exception 'Valid-read source table is missing';
  end if;

  if to_regclass('public.novel_rank_state') is null then
    raise exception 'Rank state table is missing';
  end if;

  if pg_catalog.strpos(
    pg_get_functiondef(
      'public.novelight_recalculate_work_ranks(timestamp with time zone)'::regprocedure
    ),
    'greatest(coalesce(n.pv, 0), 0)::bigint as pv'
  ) = 0 then
    raise exception 'Rank evaluator no longer matches the audited raw-PV contract';
  end if;
end
$$;
