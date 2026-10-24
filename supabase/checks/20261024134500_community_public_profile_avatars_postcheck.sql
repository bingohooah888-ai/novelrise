-- READ ONLY - verify after applying the avatar-link migration.
DO $postcheck$
BEGIN
  IF to_regprocedure('public.novelight_public_author_avatar(uuid)') IS NULL
     OR NOT pg_get_functiondef('public.novelight_community_feed(integer,integer,boolean)'::regprocedure)
          LIKE '%author_avatar_path%' THEN
    RAISE EXCEPTION 'Avatar RPC and feed payload are not installed';
  END IF;
  IF NOT has_function_privilege('anon', 'public.novelight_public_author_avatar(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.novelight_public_author_avatar(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Public author avatar RPC grants missing';
  END IF;
END
$postcheck$;
