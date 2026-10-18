-- Read-only precheck for the Safari fallback migration.
DO $$
BEGIN
 IF to_regclass('public.novel_custom_covers') IS NULL
    OR to_regprocedure('public.novelight_custom_cover_can_upload_v1(text)') IS NULL THEN
  RAISE EXCEPTION 'Safari cover migration needs baseline author cover table/function';
 END IF;
 IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
  RAISE EXCEPTION 'Safari cover migration needs Storage';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM storage.buckets
   WHERE id='novel-custom-covers' AND public IS TRUE AND file_size_limit=5242880
   AND allowed_mime_types @> ARRAY['image/webp']::text[]) THEN
  RAISE EXCEPTION 'Safari cover migration needs the baseline 5MiB WebP bucket';
 END IF;
END
$$;
