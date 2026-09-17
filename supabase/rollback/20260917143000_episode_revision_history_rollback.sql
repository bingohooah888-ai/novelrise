-- Rollback for 20260917143000_episode_revision_history.sql

drop trigger if exists episode_revision_history_before_update on public.episodes;
drop function if exists public.novelight_restore_episode_revision(uuid, uuid);
drop function if exists public.novelight_get_episode_revision(uuid);
drop function if exists public.novelight_list_episode_revisions(uuid);
drop function if exists public.novelight_capture_episode_revision();
drop table if exists public.episode_revisions;
