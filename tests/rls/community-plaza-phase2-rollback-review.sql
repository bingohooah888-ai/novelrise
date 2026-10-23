\set ON_ERROR_STOP on
-- Disposable CI migration-replay database only, NEVER a hosted project.
-- The precheck in the rollback candidate must prevent loss of board data.
BEGIN;
\ir ../../supabase/migrations/20261023055617_community_plaza_phase2_board.sql
\ir ../../supabase/rollback/20261023055617_community_plaza_phase2_board_rollback.sql
DO $board_review_rollback$
BEGIN
 IF to_regclass('public.community_board_threads') IS NOT NULL THEN
   RAISE EXCEPTION 'Empty Phase 2 rollback left a board table';
 END IF;
 IF to_regprocedure('public.novelight_community_board_save(text,text,text,boolean,uuid)') IS NOT NULL
   OR to_regprocedure('public.novelight_community_board_visible(uuid)') IS NOT NULL THEN
   RAISE EXCEPTION 'Empty Phase 2 rollback left board RPCs';
 END IF;
 IF to_regprocedure('public.novelight_community_feed(integer,integer,boolean)') IS NULL
   OR to_regprocedure('public.novelight_community_post_visible(text)') IS NULL
   OR to_regprocedure('public.novelight_community_post_author(text)') IS NULL THEN
   RAISE EXCEPTION 'Rollback removed shared Phase 1 APIs';
 END IF;
 IF EXISTS (
   SELECT 1 FROM pg_proc
   WHERE proname='novelight_community_post_visible'
     AND pronamespace='public'::regnamespace
     AND prosrc LIKE '%board:%'
 ) THEN RAISE EXCEPTION 'Rollback retained Phase 2 board visibility logic'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.community_runtime_control ctl
   WHERE ctl.singleton AND NOT ctl.public_enabled
 ) THEN RAISE EXCEPTION 'Rollback altered Phase 1 public gate'; END IF;
END
$board_review_rollback$;
ROLLBACK;
