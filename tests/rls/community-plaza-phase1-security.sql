\set ON_ERROR_STOP on
-- Run on disposable migration-replay DB only, never against Production.
-- Uses read-only catalog checks and a rollback-contained role simulation.
BEGIN;

DO $plaza_schema$
DECLARE v_table text; v_role text; v_rls boolean;
BEGIN
 FOREACH v_table IN ARRAY ARRAY[
 'community_reactions','community_comments','community_reports',
 'community_hidden_posts','community_user_restrictions',
 'community_notifications','community_seed_shares'] LOOP
  IF to_regclass('public.'||v_table) IS NULL THEN
    RAISE EXCEPTION 'Community table absent: %',v_table;
  END IF;
  SELECT relrowsecurity INTO v_rls FROM pg_class
   WHERE oid=to_regclass('public.'||v_table);
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Community RLS disabled: %',v_table;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(v_role,'public.'||v_table,'SELECT')
      OR has_table_privilege(v_role,'public.'||v_table,'INSERT')
      OR has_table_privilege(v_role,'public.'||v_table,'UPDATE')
      OR has_table_privilege(v_role,'public.'||v_table,'DELETE') THEN
      RAISE EXCEPTION 'Private table leaked: % to %',v_table,v_role;
    END IF;
  END LOOP;
 END LOOP;
 IF to_regprocedure('public.novelight_admin_community_moderate(uuid,text,text,uuid,text)') IS NULL
   OR to_regprocedure('public.novelight_admin_community_metrics(integer)') IS NULL
   OR to_regprocedure('public.novelight_save_my_author_note_v2(bigint,text,text,bigint,boolean,boolean)') IS NULL
   OR to_regprocedure('public.novelight_community_feed(integer,integer,boolean)') IS NULL THEN
   RAISE EXCEPTION 'Required community RPC signature missing';
 END IF;
 IF has_function_privilege('anon',
   'public.novelight_admin_community_moderate(uuid,text,text,uuid,text)','EXECUTE')
   OR has_function_privilege('authenticated',
   'public.novelight_admin_community_moderate(uuid,text,text,uuid,text)','EXECUTE')
   OR has_function_privilege('anon',
   'public.novelight_admin_community_metrics(integer)','EXECUTE')
   OR has_function_privilege('authenticated',
   'public.novelight_admin_community_metrics(integer)','EXECUTE')
   OR has_function_privilege('anon',
   'public.novelight_save_my_author_note_v2(bigint,text,text,bigint,boolean,boolean)','EXECUTE') THEN
   RAISE EXCEPTION 'Administrative or authenticated-only RPC exposed to guest';
 END IF;
 IF NOT has_function_privilege('service_role',
   'public.novelight_admin_community_metrics(integer)','EXECUTE')
   OR NOT has_function_privilege('service_role',
   'public.novelight_admin_community_moderate(uuid,text,text,uuid,text)','EXECUTE')
   OR NOT has_function_privilege('anon',
   'public.novelight_community_feed(integer,integer,boolean)','EXECUTE') THEN
   RAISE EXCEPTION 'Necessary public/admin grants missing';
 END IF;
END
$plaza_schema$;

SET LOCAL ROLE anon;
DO $plaza_guest$
DECLARE v_feed jsonb;
BEGIN
 SELECT public.novelight_community_feed(5,0,false) INTO v_feed;
 IF pg_catalog.jsonb_typeof(v_feed) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Public feed response is not an array';
 END IF;
 BEGIN
  PERFORM public.novelight_community_toggle_like('official:1');
  RAISE EXCEPTION 'Anonymous user liked a post';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$plaza_guest$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
DO $plaza_no_user$
BEGIN
 BEGIN
  PERFORM public.novelight_community_toggle_like('official:1');
  RAISE EXCEPTION 'Missing-user session liked a post';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$plaza_no_user$;
RESET ROLE;
ROLLBACK;
