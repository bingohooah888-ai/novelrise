\set ON_ERROR_STOP on
BEGIN;
DO $check$
DECLARE v_name text;
BEGIN
 FOREACH v_name IN ARRAY ARRAY[
 'community_reactions','community_comments','community_reports',
 'community_hidden_posts','community_user_restrictions','community_notifications',
 'community_seed_shares'] LOOP
   IF to_regclass('public.'||v_name) IS NOT NULL THEN
     RAISE EXCEPTION 'Rollback retained table: %',v_name;
   END IF;
 END LOOP;
 IF to_regprocedure('public.novelight_community_feed(integer,integer,boolean)') IS NOT NULL
    OR to_regprocedure('public.novelight_admin_community_metrics(integer)') IS NOT NULL
    OR to_regprocedure('public.novelight_save_my_author_note_v2(bigint,text,text,bigint,boolean,boolean)') IS NOT NULL THEN
   RAISE EXCEPTION 'Rollback retained community RPC';
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='author_notes'
       AND column_name='show_in_timeline')
   OR EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='reader_curation_lists'
       AND column_name='community_share_enabled') THEN
   RAISE EXCEPTION 'Rollback retained community public consent column';
 END IF;
 IF to_regclass('public.author_notes') IS NULL
    OR to_regclass('public.reader_curation_lists') IS NULL
    OR to_regclass('public.valid_read_events') IS NULL
    OR to_regclass('public.light_seeds') IS NULL THEN
   RAISE EXCEPTION 'Rollback damaged canonical tables';
 END IF;
END
$check$;
ROLLBACK;
