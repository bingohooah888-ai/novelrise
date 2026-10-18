-- Read-only postcheck: the MIME, RLS and size contract must agree.
DO $$
DECLARE
 constraint_def text;
 guard_def text;
 upload_policy text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO constraint_def
  FROM pg_constraint WHERE conrelid='public.novel_custom_covers'::regclass
  AND conname='novel_custom_cover_path_check';
 IF constraint_def IS NULL OR position('webp|png|jpg' IN constraint_def)=0 THEN
  RAISE EXCEPTION 'Safari cover path constraint mismatch';
 END IF;
 SELECT pg_get_functiondef('public.novelight_custom_cover_can_upload_v1(text)'::regprocedure)
  INTO guard_def;
 IF position('webp|png|jpg' IN guard_def)=0 OR position('v_count < 3' IN guard_def)=0 THEN
  RAISE EXCEPTION 'Safari upload guard MIME or 3-object quota mismatch';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='novel-custom-covers'
    AND public IS TRUE AND file_size_limit=5242880
    AND allowed_mime_types @> ARRAY['image/webp','image/png','image/jpeg']::text[]) THEN
  RAISE EXCEPTION 'Safari cover MIME/size bucket mismatch';
 END IF;
 SELECT with_check INTO upload_policy
  FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
  AND policyname='Authors upload own work cover objects';
 IF upload_policy IS NULL OR position('webp|png|jpg' IN upload_policy)=0
  OR position('novelight_custom_cover_can_upload_v1' IN upload_policy)=0 THEN
  RAISE EXCEPTION 'Safari cover upload policy mismatch';
 END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public'
    AND tablename='novel_custom_covers') <> 4 THEN
  RAISE EXCEPTION 'Owner cover table policies have changed';
 END IF;
END
$$;
