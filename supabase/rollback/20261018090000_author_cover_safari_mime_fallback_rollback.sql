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
-- This rollback is forward-data-safe and does not delete any author image.
-- Revert function, bucket and policy only after zero PNG/JPEG references/objects.
