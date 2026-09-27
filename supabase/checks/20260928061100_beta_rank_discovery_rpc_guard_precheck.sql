-- Precheck for beta work-Rank RPC guard.
do $$
begin
  if to_regprocedure('public.novelight_scout_discoveries_rank_internal_20260928(integer)') is null
     or to_regprocedure('public.novelight_scout_recent_activity_rank_internal_20260928(integer)') is null
     or to_regprocedure('public.novelight_scout_record_summary_rank_internal_20260928()') is null
     or to_regprocedure('public.novelight_scout_point_history_rank_internal_20260928(integer)') is null then
    raise exception 'Beta Rank privacy backups are missing';
  end if;

  if to_regprocedure('public.novelight_set_scout_badge_visibility(text,boolean)') is null
     or to_regprocedure('public.novelight_set_scout_badge_visibility_rank_internal_20260928(text,boolean)') is not null then
    raise exception 'Title visibility RPC is not in the expected pre-guard state';
  end if;
end
$$;
