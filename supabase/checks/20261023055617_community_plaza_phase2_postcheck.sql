-- Read-only Phase 2 migration postcheck: must remain invisible until joint release.
DO $phase2_postcheck$
BEGIN
  IF to_regclass('public.community_board_threads') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class
             WHERE oid=to_regclass('public.community_board_threads'))
  THEN RAISE EXCEPTION 'Board table missing or RLS not enabled'; END IF;
  IF EXISTS (SELECT 1 FROM public.community_board_threads)
  THEN RAISE EXCEPTION 'Phase 2 migration unexpectedly created board content'; END IF;
  IF has_table_privilege('anon','public.community_board_threads','SELECT')
    OR has_table_privilege('authenticated','public.community_board_threads','SELECT')
    OR has_table_privilege('anon','public.community_board_threads','INSERT')
    OR has_table_privilege('authenticated','public.community_board_threads','INSERT')
    OR has_table_privilege('authenticated','public.community_board_threads','UPDATE')
    OR has_table_privilege('authenticated','public.community_board_threads','DELETE')
  THEN RAISE EXCEPTION 'Board raw table is exposed to a browser role'; END IF;
  IF has_function_privilege('anon','public.novelight_community_board_save(text,text,text,boolean,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.novelight_community_board_delete(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.novelight_community_board_visible(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.novelight_community_board_save(text,text,text,boolean,uuid)','EXECUTE')
    OR NOT has_function_privilege('anon','public.novelight_community_board_list(text,integer,integer)','EXECUTE')
  THEN RAISE EXCEPTION 'Board RPC privileges are not least-privileged'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_runtime_control ctl
                 WHERE ctl.singleton AND NOT ctl.public_enabled AND ctl.activated_at IS NULL)
  THEN RAISE EXCEPTION 'Phase 2 changed or bypassed the disabled public gate'; END IF;
  IF jsonb_array_length(public.novelight_community_board_list(NULL,15,0)) <> 0
  THEN RAISE EXCEPTION 'Board direct RPC leaked while runtime OFF'; END IF;
END
$phase2_postcheck$;
