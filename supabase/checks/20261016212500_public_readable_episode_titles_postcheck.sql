-- Staging read-only postcheck for 20261016212500.
DO $postcheck$
DECLARE
  v_index regprocedure := to_regprocedure('public.novelight_reader_episode_index(text[])');
  v_chapter regprocedure := to_regprocedure('public.novelight_reader_episode_chapter_index(text[])');
  v_follow regprocedure := to_regprocedure('public.novelight_followed_author_updates(integer)');
BEGIN
  IF v_index IS NULL OR v_chapter IS NULL OR v_follow IS NULL THEN
    RAISE EXCEPTION 'public episode title migration: required RPC missing after apply';
  END IF;
  IF NOT has_function_privilege('anon', v_index, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_index, 'EXECUTE')
     OR NOT has_function_privilege('anon', v_chapter, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_chapter, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_follow, 'EXECUTE')
     OR has_function_privilege('anon', v_follow, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'public episode title migration: unexpected RPC grants';
  END IF;
  IF position('valid_read_events' IN pg_get_functiondef(v_index::oid)) > 0
    OR position('valid_read_events' IN pg_get_functiondef(v_follow::oid)) > 0
  THEN
    RAISE EXCEPTION 'public episode title migration: read-progress mask remains';
  END IF;
  IF position('idx.episode_title is not null' IN lower(pg_get_functiondef(v_chapter::oid))) > 0 THEN
    RAISE EXCEPTION 'public episode title migration: chapter heading remains masked';
  END IF;
END
$postcheck$;
