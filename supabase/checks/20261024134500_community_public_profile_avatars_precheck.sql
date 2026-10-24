-- READ ONLY - perform before deploying the avatar-link migration.
DO $precheck$
BEGIN
  IF to_regprocedure('public.novelight_community_feed(integer,integer,boolean)') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.novels') IS NULL THEN
    RAISE EXCEPTION 'Required existing community or profile objects missing';
  END IF;
  IF NOT EXISTS (
     SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='avatar_path'
  ) THEN
     RAISE EXCEPTION 'Profile avatar column missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='author-avatars' AND public) THEN
    RAISE EXCEPTION 'Public author-avatars storage bucket missing or not public';
  END IF;
END
$precheck$;
