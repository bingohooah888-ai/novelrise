\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260921022608:rollback'));

drop trigger if exists scout_badge_track_author_seed_growth on public.seed_discovery_state;
drop trigger if exists scout_badge_track_author_completion on public.novel_rank_state;
drop trigger if exists scout_badge_track_author_seed on public.light_seeds;
drop trigger if exists scout_badge_track_author_unique_reader on public.valid_read_events;
drop trigger if exists scout_badge_track_author_comment on public.novel_comments;
drop trigger if exists scout_badge_track_author_favorite on public.favorites;
drop trigger if exists scout_badge_track_author_episode on public.episodes;
drop trigger if exists scout_badge_track_author_work on public.novels;

drop function if exists public.novelight_public_scout_record(uuid);
drop function if exists public.novelight_set_scout_badge_visibility(text, boolean);
drop function if exists public.novelight_scout_badges();
drop function if exists public.novelight_refresh_my_scout_badges();
drop function if exists public.novelight_apply_scout_badge_progress(uuid, text, bigint, jsonb);
drop function if exists public.novelight_track_author_seed_growth_badges();
drop function if exists public.novelight_track_author_completion_badges();
drop function if exists public.novelight_track_author_seed_badges();
drop function if exists public.novelight_track_author_unique_reader_badges();
drop function if exists public.novelight_track_author_comment_badges();
drop function if exists public.novelight_track_author_favorite_badges();
drop function if exists public.novelight_track_author_episode_badges();
drop function if exists public.novelight_track_author_work_badges();
drop function if exists public.novelight_record_scout_badge_metric(uuid, text, bigint, text, jsonb);

do $$
declare
  v_has_user_badges boolean;
  v_has_metric_events boolean;
begin
  -- Founding Author / beta Participant rows are deterministic identity
  -- materializations backed by their qualification ledgers. They may be
  -- rematerialized after rollback; only non-derivable earned/progress rows
  -- force preservation of the badge tables.
  select exists (
    select 1
    from public.user_scout_badges
    where badge_id not in (
      'limited_founding_author',
      'limited_beta_participant'
    )
  ) into v_has_user_badges;
  select exists (select 1 from public.scout_badge_metric_events)
    into v_has_metric_events;

  if not v_has_user_badges and not v_has_metric_events then
    drop table public.scout_episode_badge_state;
    drop table public.scout_badge_metric_state;
    drop table public.scout_badge_metric_events;
    drop table public.user_scout_badges;
    drop table public.scout_badge_definitions;
    drop table public.scout_badge_runtime_config;
  else
    revoke all on table public.scout_badge_runtime_config from public, anon, authenticated;
    revoke all on table public.scout_badge_definitions from public, anon, authenticated;
    revoke all on table public.user_scout_badges from public, anon, authenticated;
    revoke all on table public.scout_badge_metric_events from public, anon, authenticated;
    revoke all on table public.scout_badge_metric_state from public, anon, authenticated;
    revoke all on table public.scout_episode_badge_state from public, anon, authenticated;
  end if;
end
$$;

commit;
