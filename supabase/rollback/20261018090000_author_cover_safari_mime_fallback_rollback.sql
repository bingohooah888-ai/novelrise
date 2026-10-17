-- Fail closed if live PNG/JPEG covers are referenced or stored.
begin;
select pg_advisory_xact_lock(hashtext('novelight:cover-safari-mime'));
do $$
begin
 if exists(select 1 from public.novel_custom_covers where storage_path ~ '\.(png|jpg)$') then
  raise exception 'Cannot roll back with active PNG/JPEG cover references';
 end if;
 if to_regclass('storage.objects') is not null and exists(
  select 1 from storage.objects where bucket_id='novel-custom-covers'
  and name ~ '\.(png|jpg)$') then
  raise exception 'Cannot roll back with PNG/JPEG objects still stored';
 end if;
end
$$;
alter table public.novel_custom_covers drop constraint novel_custom_cover_path_check;
alter table public.novel_custom_covers add constraint novel_custom_cover_path_check check (
 storage_path ~ ('^' || user_id::text || '/' || novel_id::text ||
 '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$')
);
create or replace function public.novelight_custom_cover_can_upload_v1(p_name text)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, auth, storage
as $
declare
  v_uid uuid := (select auth.uid());
  v_novel text := split_part(coalesce(p_name, ''), '/', 2);
  v_count integer;
begin
  if v_uid is null or p_name !~ (
    '^' || v_uid::text || '/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp
  ) then return false; end if;
  if not exists (
    select 1 from public.novels n
    where n.id::text = v_novel and n.user_id = v_uid
  ) then return false; end if;
  perform pg_advisory_xact_lock(hashtext('novelight:custom-cover:' || v_uid::text || ':' || v_novel));
  select count(*)::integer into v_count from storage.objects o
  where o.bucket_id = 'novel-custom-covers'
    and o.name like v_uid::text || '/' || v_novel || '/%';
  return v_count < 3;
exception when undefined_table or invalid_schema_name then
  return false;
end
$;
do $
begin
 if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
  raise notice 'Storage unavailable during isolated migration replay'; return;
 end if;
 update storage.buckets set allowed_mime_types=array['image/webp']::text[]
 where id='novel-custom-covers';
 execute 'drop policy if exists "Authors upload own work cover objects" on storage.objects';
 execute $policy$
 create policy "Authors upload own work cover objects"
 on storage.objects for insert to authenticated with check (
  bucket_id='novel-custom-covers'
  and name ~ ('^' || (select auth.uid())::text ||
  '/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp)
  and public.novelight_custom_cover_can_upload_v1(name)
 )
 $policy$;
end
$;
commit;
