-- Read-only inspection: run before applying the Safari PNG contract migration.
begin;
do $$
begin
  if pg_catalog.to_regclass('public.episode_illustrations') is null
     or pg_catalog.to_regclass('storage.buckets') is null then
    raise exception 'PRECHECK FAIL: illustration prerequisites are missing';
  end if;
  if not exists (
    select 1 from storage.buckets b
     where b.id='episode-illustrations' and b.public=false
       and b.file_size_limit=10485760
       and b.allowed_mime_types=array['image/webp']::text[]
  ) then
    raise exception 'PRECHECK FAIL: expected private WebP-only starting bucket is absent';
  end if;
  if exists (
    select 1 from public.episode_illustrations i
     where i.mime_type <> 'image/webp' or i.storage_path !~ '\.webp$'
  ) then
    raise exception 'PRECHECK FAIL: unexpected existing MIME/extension data';
  end if;
  raise notice 'PRECHECK PASS: current private WebP-only storage and registry baseline verified';
end
$$;
rollback;
