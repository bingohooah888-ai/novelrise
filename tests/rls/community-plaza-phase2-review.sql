\set ON_ERROR_STOP on
-- CI-only, disposable migration-replay database. Always roll back Phase 2 review DDL
-- and test users; never connect this fixture to any hosted Supabase instance.
BEGIN;
\ir ../../supabase/migrations/20261023055617_community_plaza_phase2_board.sql

DO $board_schema$
DECLARE v_role text;
BEGIN
 IF to_regclass('public.community_board_threads') IS NULL OR
   NOT (SELECT relrowsecurity FROM pg_class
     WHERE oid=to_regclass('public.community_board_threads')) THEN
    RAISE EXCEPTION 'Board table missing or RLS OFF';
 END IF;
 FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_table_privilege(v_role,'public.community_board_threads','SELECT')
   OR has_table_privilege(v_role,'public.community_board_threads','INSERT')
   OR has_table_privilege(v_role,'public.community_board_threads','UPDATE')
   OR has_table_privilege(v_role,'public.community_board_threads','DELETE') THEN
   RAISE EXCEPTION 'Board raw table exposed to %',v_role;
  END IF;
 END LOOP;
 IF has_function_privilege('anon','public.novelight_community_board_save(text,text,text,boolean,uuid)','EXECUTE')
  OR has_function_privilege('anon','public.novelight_community_board_delete(uuid)','EXECUTE')
  OR has_function_privilege('anon','public.novelight_community_board_visible(uuid)','EXECUTE')
  OR NOT has_function_privilege('anon','public.novelight_community_board_list(text,integer,integer)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.novelight_community_board_save(text,text,text,boolean,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Board RPC grants not least-privileged';
 END IF;
 IF (SELECT public_enabled FROM public.community_runtime_control WHERE singleton) THEN
  RAISE EXCEPTION 'Phase 2 SQL unexpectedly enabled the global public gate';
 END IF;
 IF jsonb_array_length(public.novelight_community_board_list(NULL,15,0))<>0 THEN
  RAISE EXCEPTION 'Board list active while global public gate OFF';
 END IF;
END
$board_schema$;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
DO $board_guest$
BEGIN
 IF jsonb_array_length(public.novelight_community_board_list(NULL,15,0))<>0 THEN
  RAISE EXCEPTION 'Guest saw board while gate OFF';
 END IF;
 BEGIN
  PERFORM public.novelight_community_board_save('general','Illegal thread','Denied',true,NULL);
  RAISE EXCEPTION 'Anonymous user created a thread';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$board_guest$;
RESET ROLE;

INSERT INTO auth.users(id,raw_user_meta_data) VALUES
 ('c0b00000-0000-4000-8000-000000000001','{"display_name":"Board CI Author"}'::jsonb),
 ('c0b00000-0000-4000-8000-000000000002','{"display_name":"Board CI Reader"}'::jsonb)
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.profiles(id,display_name,created_at) VALUES
 ('c0b00000-0000-4000-8000-000000000001','Board CI Author',now()-interval '2 days'),
 ('c0b00000-0000-4000-8000-000000000002','Board CI Reader',now()-interval '2 days')
ON CONFLICT(id) DO UPDATE
 SET display_name=excluded.display_name,created_at=excluded.created_at;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','c0b00000-0000-4000-8000-000000000001',true);
DO $board_closed_author$
BEGIN
 BEGIN
  PERFORM public.novelight_community_board_save('stories','Closed title','Closed body',true,NULL);
  RAISE EXCEPTION 'Author bypassed global disabled gate';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$board_closed_author$;
RESET ROLE;

-- Enable only inside the isolated, rollback-contained transaction.
UPDATE public.community_runtime_control SET public_enabled=true WHERE singleton;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','c0b00000-0000-4000-8000-000000000001',true);
DO $board_author$
DECLARE v_id uuid; v_key text;
BEGIN
 BEGIN
  PERFORM public.novelight_community_board_save('stories','No confirmation','Blocked body',false,NULL);
  RAISE EXCEPTION 'Board accepted missing general-audience confirmation';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 v_id:=public.novelight_community_board_save('stories','Board CI title','Safe test body',true,NULL);
 PERFORM pg_catalog.set_config('novelight.test.board.thread',v_id::text,true);
 v_key:='board:'||v_id::text;
 IF public.novelight_community_board_detail(v_id) IS NULL THEN
  RAISE EXCEPTION 'Author cannot access board through public RPC';
 END IF;
 IF (SELECT public.novelight_community_board_detail(v_id)->>'title') IS DISTINCT FROM 'Board CI title' THEN
  RAISE EXCEPTION 'Board detail mismatched';
 END IF;
 BEGIN
  PERFORM public.novelight_community_board_save('stories','Excess thread','Second thread',true,NULL);
  RAISE EXCEPTION 'Board rate limiting bypassed';
 EXCEPTION WHEN raise_exception THEN
  -- Reject the expected SQLSTATE P0001; never swallow the assertion itself.
  IF SQLERRM = 'Board rate limiting bypassed' THEN RAISE; END IF;
 END;
END
$board_author$;
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
DO $board_public$
DECLARE v_id uuid:=current_setting('novelight.test.board.thread')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
  public.novelight_community_board_list('stories',15,0)) x WHERE x->>'id'=v_id::text) THEN
  RAISE EXCEPTION 'Published board thread invisible to guest';
 END IF;
 IF public.novelight_community_board_detail(v_id)->>'body' IS DISTINCT FROM 'Safe test body' THEN
  RAISE EXCEPTION 'Published board detail missing';
 END IF;
END
$board_public$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','c0b00000-0000-4000-8000-000000000002',true);
DO $board_reader$
DECLARE v_id uuid:=current_setting('novelight.test.board.thread')::uuid;
 v_key text:='board:'||v_id::text; v_result jsonb;
BEGIN
 BEGIN
  PERFORM public.novelight_community_board_save('general','Foreign edit','Unauthorized',true,v_id);
  RAISE EXCEPTION 'Non-owner edited board thread';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM public.novelight_community_board_delete(v_id);
  RAISE EXCEPTION 'Non-owner deleted board thread';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 v_result:=public.novelight_community_post_comment(v_key,'Reader fixture reply',NULL);
 IF v_result->>'id' IS NULL OR jsonb_array_length(public.novelight_community_comments(v_key,20))<>1 THEN
  RAISE EXCEPTION 'Board reply did not reuse shared comment system';
 END IF;
 IF public.novelight_community_report(v_key,'CI report fixture') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Board report did not use shared ledger';
 END IF;
END
$board_reader$;
RESET ROLE;

-- Check that a board reply produces the existing shared notification and that
-- reporting uses the existing private report ledger (not a parallel table).
DO $board_notification$
DECLARE v_key text:='board:'||current_setting('novelight.test.board.thread');
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.community_notifications n
   WHERE n.post_key=v_key AND n.kind='comment'
     AND n.recipient_user_id='c0b00000-0000-4000-8000-000000000001'
     AND n.actor_user_id='c0b00000-0000-4000-8000-000000000002'
 ) THEN RAISE EXCEPTION 'Board reply did not notify thread creator'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.community_reports cr
   WHERE cr.post_key=v_key AND
     cr.reporter_user_id='c0b00000-0000-4000-8000-000000000002'
 ) THEN RAISE EXCEPTION 'Board report did not use private moderation ledger'; END IF;
END
$board_notification$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','c0b00000-0000-4000-8000-000000000001',true);
DO $board_owner_edit$
DECLARE v_id uuid:=current_setting('novelight.test.board.thread')::uuid;
 v_data jsonb;
BEGIN
 IF public.novelight_community_board_save(
  'writing','Edited Board CI title','Owner edited content',true,v_id
 ) IS DISTINCT FROM v_id THEN
   RAISE EXCEPTION 'Owner edit did not return original thread ID';
 END IF;
 v_data:=public.novelight_community_board_detail(v_id);
 IF v_data->>'title' IS DISTINCT FROM 'Edited Board CI title'
   OR v_data->>'category' IS DISTINCT FROM 'writing'
   OR v_data->>'body' IS DISTINCT FROM 'Owner edited content' THEN
   RAISE EXCEPTION 'Owner edited content not visible through board detail'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(
     public.novelight_community_board_list('writing',15,0)) x
   WHERE x->>'id'=v_id::text
 ) THEN RAISE EXCEPTION 'Edited board thread not discoverable in new category'; END IF;
END
$board_owner_edit$;
RESET ROLE;

INSERT INTO public.user_blocks(blocker_user_id,blocked_user_id)
 VALUES ('c0b00000-0000-4000-8000-000000000001','c0b00000-0000-4000-8000-000000000002');

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','c0b00000-0000-4000-8000-000000000002',true);
DO $board_blocked$
DECLARE v_id uuid:=current_setting('novelight.test.board.thread')::uuid;
BEGIN
 IF public.novelight_community_board_detail(v_id) IS NOT NULL
  OR jsonb_array_length(public.novelight_community_board_list(NULL,15,0))<>0
  OR jsonb_array_length(public.novelight_community_comments('board:'||v_id::text,20))<>0 THEN
  RAISE EXCEPTION 'Blocked reader accessed thread or replies';
 END IF;
 BEGIN
  PERFORM public.novelight_community_post_comment('board:'||v_id::text,'Bypassed block',NULL);
  RAISE EXCEPTION 'Blocked reader posted reply';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$board_blocked$;
RESET ROLE;

DELETE FROM public.user_blocks
WHERE blocker_user_id='c0b00000-0000-4000-8000-000000000001'
 AND blocked_user_id='c0b00000-0000-4000-8000-000000000002';

INSERT INTO public.user_mutes(muter_user_id,muted_user_id)
 VALUES ('c0b00000-0000-4000-8000-000000000002',
         'c0b00000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','c0b00000-0000-4000-8000-000000000002',true);
DO $board_muted$
DECLARE v_id uuid:=current_setting('novelight.test.board.thread')::uuid;
BEGIN
 IF public.novelight_community_board_detail(v_id) IS NOT NULL
  OR jsonb_array_length(public.novelight_community_board_list(NULL,15,0))<>0 THEN
  RAISE EXCEPTION 'Muted author still visible through board RPCs';
 END IF;
END
$board_muted$;
RESET ROLE;
DELETE FROM public.user_mutes
 WHERE muter_user_id='c0b00000-0000-4000-8000-000000000002'
   AND muted_user_id='c0b00000-0000-4000-8000-000000000001';

-- Exercise real staff moderation RPC (the admin web handler calls this with
-- a server-only service_role client). Do not simulate hiding only with raw SQL.
DO $board_admin_hide$
DECLARE v_key text:='board:'||current_setting('novelight.test.board.thread');
BEGIN
 IF public.novelight_admin_community_moderate(
   'c0b00000-0000-4000-8000-000000000001'::uuid,'hide',v_key,NULL,'CI hide test'
 ) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Board hide moderation failed'; END IF;
END
$board_admin_hide$;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','c0b00000-0000-4000-8000-000000000002',true);
DO $board_hidden$
DECLARE v_id uuid:=current_setting('novelight.test.board.thread')::uuid;
BEGIN
 IF public.novelight_community_board_detail(v_id) IS NOT NULL
  OR jsonb_array_length(public.novelight_community_board_list(NULL,15,0))<>0 THEN
  RAISE EXCEPTION 'Admin-hidden thread leaked';
 END IF;
END
$board_hidden$;
RESET ROLE;

DO $board_admin_restore$
DECLARE v_key text:='board:'||current_setting('novelight.test.board.thread');
BEGIN
 IF public.novelight_admin_community_moderate(
   'c0b00000-0000-4000-8000-000000000001'::uuid,'restore',v_key,NULL,'CI restore test'
 ) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Board restore moderation failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.community_hidden_posts WHERE post_key=v_key)
 THEN RAISE EXCEPTION 'Board still hidden after staff restore'; END IF;
END
$board_admin_restore$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','c0b00000-0000-4000-8000-000000000001',true);
DO $board_deleted$
DECLARE v_id uuid:=current_setting('novelight.test.board.thread')::uuid;
BEGIN
 IF public.novelight_community_board_delete(v_id) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Owner unable to soft-delete thread';
 END IF;
 IF public.novelight_community_board_detail(v_id) IS NOT NULL
  OR jsonb_array_length(public.novelight_community_board_list(NULL,15,0))<>0
  OR jsonb_array_length(public.novelight_community_comments('board:'||v_id::text,20))<>0 THEN
  RAISE EXCEPTION 'Deleted thread remains exposed by public RPC';
 END IF;
END
$board_deleted$;
RESET ROLE;

ROLLBACK;
