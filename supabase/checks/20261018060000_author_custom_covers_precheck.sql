-- Read-only precheck for owner-uploaded covers on isolated Staging.
DO $$
BEGIN
  IF to_regclass('public.novels') IS NULL THEN
    RAISE EXCEPTION 'custom covers precheck: missing novels table';
  END IF;
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'custom covers precheck: Supabase Storage is unavailable';
  END IF;
  IF to_regclass('public.novel_custom_covers') IS NOT NULL THEN
    RAISE EXCEPTION 'custom covers precheck: destination table already exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'novel-custom-covers'
  ) THEN
    RAISE EXCEPTION 'custom covers precheck: storage bucket already exists';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'novels'
      AND column_name = 'id' AND udt_name = 'int8'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'novels'
      AND column_name = 'user_id' AND udt_name = 'uuid'
  ) THEN
    RAISE EXCEPTION 'custom covers precheck: expected novel owner schema not present';
  END IF;
END;
$$;
