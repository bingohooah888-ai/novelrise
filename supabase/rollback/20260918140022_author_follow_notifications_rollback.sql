-- Rollback for 20260918140022_author_follow_notifications.sql

begin;

drop trigger if exists novelight_author_follow_novel_publication on public.novels;
drop trigger if exists novelight_author_follow_episode_publication on public.episodes;

drop function if exists public.novelight_mark_author_follow_updates_seen(uuid, bigint, bigint);
drop function if exists public.novelight_followed_author_updates(integer);
drop function if exists public.novelight_set_author_follow_notifications(uuid, boolean, boolean);
drop function if exists public.novelight_set_author_follow(uuid, boolean);
drop function if exists public.novelight_author_follow_state(uuid);
drop function if exists public.novelight_capture_author_follow_event();

drop table if exists public.author_follow_events;
drop table if exists public.author_follows;

commit;
