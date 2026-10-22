\set ON_ERROR_STOP on
-- Read-only postcheck for the proposed migration.
BEGIN;
DO $post$
DECLARE v_table text; v_col record;
BEGIN
 FOREACH v_table IN ARRAY ARRAY[
 'community_reactions','community_comments','community_reports',
 'community_hidden_posts','community_user_restrictions','community_notifications',
 'community_seed_shares','community_runtime_control'] LOOP
  IF to_regclass('public.'||v_table) IS NULL THEN
   RAISE EXCEPTION 'Missing community table: %',v_table;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||v_table)
     AND relrowsecurity) THEN RAISE EXCEPTION 'RLS missing: %',v_table; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.community_runtime_control ctl
  WHERE ctl.singleton AND ctl.public_enabled=false) THEN
   RAISE EXCEPTION 'DB public gate must default disabled';
 END IF;
 IF has_table_privilege('anon','public.community_runtime_control','SELECT')
 OR has_table_privilege('authenticated','public.community_runtime_control','UPDATE')
 THEN RAISE EXCEPTION 'DB public gate grants unsafe'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='author_notes'
    AND column_name='show_in_timeline' AND is_nullable='NO'
    AND column_default LIKE '%false%')
 OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reader_curation_lists'
    AND column_name='community_share_enabled' AND is_nullable='NO'
    AND column_default LIKE '%false%') THEN
   RAISE EXCEPTION 'Global-sharing consent is not fail-closed by default';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.author_notes'::regclass
      AND tgname='community_author_note_consent_guard' AND NOT tgisinternal)
 OR NOT EXISTS(SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.reader_curation_lists'::regclass
      AND tgname='community_curation_visibility_guard' AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'Consent invalidation triggers missing'; END IF;
 IF to_regprocedure('public.novelight_community_mark_notifications_read(bigint[])') IS NULL THEN
   RAISE EXCEPTION 'Missing notification read acknowledgement RPC';
 END IF;
 IF has_function_privilege('anon',
    'public.novelight_community_mark_notifications_read(bigint[])','EXECUTE')
 OR NOT has_function_privilege('authenticated',
    'public.novelight_community_mark_notifications_read(bigint[])','EXECUTE') THEN
   RAISE EXCEPTION 'Notification read acknowledgement permission mismatch';
 END IF;
 IF has_function_privilege('anon',
   'public.novelight_admin_community_metrics(integer)','execute')
 OR has_function_privilege('authenticated',
   'public.novelight_admin_community_metrics(integer)','execute')
 THEN RAISE EXCEPTION 'Admin metrics exposed to clients'; END IF;
END
$post$;
ROLLBACK;
