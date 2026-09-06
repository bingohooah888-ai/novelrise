-- Retire the author gallery feature without deleting existing Storage objects or the bucket.
-- The earlier gallery migration may already exist in non-Production environments, so this
-- is a forward-only retirement rather than a rollback. Production application requires
-- separate OWNER approval.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260906204000'));

revoke all on function public.novelight_author_gallery_can_upload_v1(text)
  from public, anon, authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects is unavailable; skipping author gallery policy retirement';
    return;
  end if;

  -- Preserve existing files and read compatibility, but prevent new uploads or
  -- client-side deletions now that NOVELIGHT no longer exposes a gallery UI.
  execute 'drop policy if exists "Author gallery insert own" on storage.objects';
  execute 'drop policy if exists "Author gallery delete own" on storage.objects';
end
$$;

commit;
