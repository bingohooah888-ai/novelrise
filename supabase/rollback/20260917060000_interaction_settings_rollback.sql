-- Rollback for 20260917060000_interaction_settings.sql
-- Removes only the runtime introduced by that migration.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260917060000:rollback'));

drop trigger if exists novelight_enforce_comment_reception on public.novel_comments;
drop function if exists public._novelight_enforce_comment_reception();
drop function if exists public.novelight_novel_interaction_state(text);
drop function if exists public.novelight_set_novel_interaction_settings(text, boolean, boolean);
drop function if exists public.novelight_author_novel_interaction_settings(text);
drop function if exists public.novelight_set_author_interaction_defaults(boolean, boolean);
drop function if exists public.novelight_author_interaction_defaults();
drop table if exists public.novel_interaction_settings;
drop table if exists public.author_interaction_defaults;

commit;
