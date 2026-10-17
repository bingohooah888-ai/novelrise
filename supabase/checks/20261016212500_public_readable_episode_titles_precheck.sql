-- Staging read-only precheck for 20261016212500.
DO $precheck$
BEGIN
  IF to_regprocedure('public.novelight_reader_episode_index(text[])') IS NULL
    OR to_regprocedure('public.novelight_reader_episode_chapter_index(text[])') IS NULL
    OR to_regprocedure('public.novelight_followed_author_updates(integer)') IS NULL
    OR to_regprocedure('public.novelight_novel_outline(bigint)') IS NULL
  THEN
    RAISE EXCEPTION 'public episode title migration: required RPC missing';
  END IF;
  IF to_regclass('public.valid_read_events') IS NULL
    OR to_regclass('public.episodes') IS NULL
    OR to_regclass('public.novels') IS NULL
  THEN
    RAISE EXCEPTION 'public episode title migration: required reader schema missing';
  END IF;
END
$precheck$;
