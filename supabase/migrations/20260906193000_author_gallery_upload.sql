begin;

select pg_advisory_xact_lock(hashtext('novelight:20260906193000'));

-- Keep the author gallery intentionally small during beta: six public images per author,
-- each limited to 5 MB and common still-image formats only.
create or replace function public.novelight_author_gallery_can_upload_v1(p_name text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth, storage
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer := 0;
begin
  if v_uid is null then
    return false;
  end if;

  if p_name is null
     or p_name !~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$') then
    return false;
  end if;

  -- Serialize uploads per author so concurrent requests cannot bypass the six-image cap.
  perform pg_advisory_xact_lock(hashtext('novelight:author-gallery:' || v_uid::text));

  select count(*)::integer
    into v_count
    from storage.objects o
   where o.bucket_id = 'author-gallery'
     and (storage.foldername(o.name))[1] = v_uid::text;

  return v_count < 6;
exception
  when undefined_table or invalid_schema_name or undefined_function then
    return false;
end
$$;

revoke all on function public.novelight_author_gallery_can_upload_v1(text) from public, anon;
grant execute on function public.novelight_author_gallery_can_upload_v1(text) to authenticated;

-- Supabase Storage is not installed in the isolated migration-replay fixture.
do $$
declare
  v_public boolean;
  v_file_size_limit bigint;
  v_allowed_mime_types text[];
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is unavailable; skipping author gallery bucket bootstrap in compatibility replay';
    return;
  end if;

  insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  ) values (
    'author-gallery',
    'author-gallery',
    true,
    5242880,
    array['image/webp','image/png','image/jpeg']
  )
  on conflict (id) do nothing;

  select public, file_size_limit, allowed_mime_types
    into v_public, v_file_size_limit, v_allowed_mime_types
    from storage.buckets
   where id = 'author-gallery';

  if v_public is distinct from true then
    raise exception 'Existing author-gallery bucket is not public; inspect before continuing';
  end if;

  if v_file_size_limit is distinct from 5242880 then
    raise exception 'Existing author-gallery bucket file-size limit differs from 5 MB; inspect before continuing';
  end if;

  if v_allowed_mime_types is null
     or not (v_allowed_mime_types @> array['image/webp','image/png','image/jpeg']::text[]) then
    raise exception 'Existing author-gallery bucket MIME allowlist differs; inspect before continuing';
  end if;
end
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects is unavailable; skipping author gallery Storage policies in compatibility replay';
    return;
  end if;

  execute 'drop policy if exists "Author gallery select own" on storage.objects';
  execute 'drop policy if exists "Author gallery insert own" on storage.objects';
  execute 'drop policy if exists "Author gallery delete own" on storage.objects';

  execute $policy$
    create policy "Author gallery select own"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'author-gallery'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $policy$;

  execute $policy$
    create policy "Author gallery insert own"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'author-gallery'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and public.novelight_author_gallery_can_upload_v1(name)
      )
  $policy$;

  execute $policy$
    create policy "Author gallery delete own"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'author-gallery'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $policy$;
end
$$;

commit;
