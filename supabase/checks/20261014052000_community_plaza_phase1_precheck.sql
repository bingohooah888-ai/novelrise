\set ON_ERROR_STOP on
-- Read-only precheck; runs on disposable replay DB before the new migration.
BEGIN;
DO $pre$
DECLARE v_name text;
BEGIN
 FOREACH v_name IN ARRAY ARRAY[
 'community_reactions','community_comments','community_reports',
 'community_hidden_posts','community_user_restrictions','community_notifications',
 'community_seed_shares'] LOOP
  IF to_regclass('public.'||v_name) IS NOT NULL THEN
   RAISE EXCEPTION 'Community schema collision: % already exists',v_name;
  END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='author_notes'
      AND column_name='show_in_timeline')
    OR EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reader_curation_lists'
      AND column_name='community_share_enabled') THEN
   RAISE EXCEPTION 'Existing community consent column collision';
 END IF;
 IF to_regprocedure('public.novelight_save_my_author_note(bigint,text,text,bigint)') IS NULL
    OR to_regprocedure('public.novelight_create_my_curation_list(text,text)') IS NULL
    OR to_regprocedure('public.novelight_rotate_my_curation_share_token(bigint)') IS NULL
    OR to_regclass('public.light_seeds') IS NULL
    OR to_regclass('public.reader_journey_events') IS NULL
    OR to_regclass('public.valid_read_events') IS NULL THEN
    RAISE EXCEPTION 'Canonical dependencies missing, do not apply';
 END IF;
END
$pre$;
ROLLBACK;
