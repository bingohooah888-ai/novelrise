-- Read-only postcheck for the Staging author-cover migration.
DO $$
DECLARE
  v_bucket storage.buckets%rowtype;
  v_rls boolean;
BEGIN
  IF to_regclass('public.novel_custom_covers') IS NULL THEN
    RAISE EXCEPTION 'custom covers postcheck: destination table is missing';
  END IF;
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c
    WHERE c.oid = 'public.novel_custom_covers'::regclass;
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'custom covers postcheck: table RLS is disabled';
  END IF;
  SELECT * INTO v_bucket FROM storage.buckets WHERE id = 'novel-custom-covers';
  IF NOT FOUND OR v_bucket.public IS DISTINCT FROM true
    OR v_bucket.file_size_limit IS DISTINCT FROM 5242880
    OR v_bucket.allowed_mime_types IS NULL
    OR NOT ('image/webp' = ANY(v_bucket.allowed_mime_types)) THEN
    RAISE EXCEPTION 'custom covers postcheck: unexpected storage bucket configuration';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'novel_custom_covers') <> 4 THEN
    RAISE EXCEPTION 'custom covers postcheck: expected owner and public-read RLS policies';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname IN (
          'Authors select own work cover objects',
          'Authors upload own work cover objects',
          'Authors remove own work cover objects'
        )) <> 3 THEN
    RAISE EXCEPTION 'custom covers postcheck: expected Storage RLS policies';
  END IF;
  IF to_regprocedure('public.novelight_custom_cover_can_upload_v1(text)') IS NULL THEN
    RAISE EXCEPTION 'custom covers postcheck: upload guard is missing';
  END IF;
  IF has_table_privilege('anon', 'public.novel_custom_covers', 'INSERT')
     OR has_table_privilege('anon', 'public.novel_custom_covers', 'UPDATE')
     OR has_table_privilege('anon', 'public.novel_custom_covers', 'DELETE') THEN
    RAISE EXCEPTION 'custom covers postcheck: anonymous write privilege';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.novel_custom_covers', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'custom covers postcheck: authenticated grants missing';
  END IF;
END;
$$;
