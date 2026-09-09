\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260909100000'));

-- This rollback is intentionally allowed only before real rating/activity/Rank
-- evidence is collected. Once beta evidence exists, preserve it and roll forward.
do $$
begin
  if to_regclass('public.novel_star_ratings') is null then
    raise exception 'novel_star_ratings is missing; cannot prove exact rollback state';
  end if;

  if exists (select 1 from public.novel_star_ratings limit 1) then
    raise exception 'Refusing rollback: star-rating evidence already exists';
  end if;

  if exists (
    select 1
      from public.scout_event_ledger e
     where e.event_type in ('star_rating_set', 'star_rating_changed', 'star_rating_removed')
     limit 1
  ) then
    raise exception 'Refusing rollback: star-rating history already exists in SCOUT ledger';
  end if;

  if exists (
    select 1
      from public.novel_rank_state s
     where s.last_evaluated_at is not null
     limit 1
  ) then
    raise exception 'Refusing rollback: Rank engine has already evaluated works';
  end if;

  if exists (
    select 1
      from public.episodes e
     where e.updated_at is distinct from e.created_at
     limit 1
  ) then
    raise exception 'Refusing rollback: episode activity evidence changed after migration';
  end if;
end
$$;

drop function public.novelight_recalculate_work_ranks(timestamptz);
drop function public.novelight_rank_required_stability(smallint);
drop function public.novelight_rank_relative_band(double precision);
drop function public.novelight_rating_reliability_score(bigint, numeric);
drop function public.novelight_rank_absolute_ceiling(bigint, bigint, bigint, numeric);

drop function public.clear_novel_star_rating(text);
drop function public.set_novel_star_rating(text, integer);
drop function public.novelight_star_rating_status(text);

drop table public.novel_star_ratings;

alter table public.novel_rank_state
  drop column last_episode_activity_at,
  drop column last_rating_average,
  drop column last_rating_count,
  drop column last_favorite_count,
  drop column last_pv,
  drop column last_relative_rank,
  drop column last_absolute_ceiling,
  drop column last_internal_score,
  drop column last_evaluated_at,
  drop column candidate_rank_since,
  drop column candidate_rank;

drop trigger episodes_touch_novelight_updated_at on public.episodes;
drop function public.novelight_touch_episode_updated_at();
alter table public.episodes drop column updated_at;

commit;
