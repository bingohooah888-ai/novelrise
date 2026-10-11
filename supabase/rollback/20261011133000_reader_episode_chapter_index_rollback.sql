-- Revert only the optional reader chapter index. Existing reader navigation remains.
begin;
drop function if exists public.novelight_reader_episode_chapter_index(text[]);
commit;
